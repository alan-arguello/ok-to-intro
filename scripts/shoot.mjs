#!/usr/bin/env node
// Headless Chrome over CDP: screenshot + interaction + audit, no dependencies (Node 22+ global WebSocket).
// Usage:
//   node shoot.mjs --url <url> [--width 1280] [--height 900] [--full] [--out shot.png] [--scale 1]
//                  [--actions '<json array>'] [--audit]
// Actions (run in order after load): {"click":"css"} {"type":["css","text"]} {"key":"Enter"|"Meta+Enter"}
//   {"wait":ms} {"eval":"js expression"} {"scroll":y} {"shot":"/path/extra.png"} {"waitFor":"css"}
// Prints a JSON report: viewport, scrollWidth, overflow offenders, console messages, exceptions,
// eval results and (with --audit) contrast failures + small tap targets.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = { width: 1280, height: 900, full: false, out: null, actions: [], audit: false, scale: 1 };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--url') opt.url = args[++i];
  else if (a === '--width') opt.width = +args[++i];
  else if (a === '--height') opt.height = +args[++i];
  else if (a === '--full') opt.full = true;
  else if (a === '--out') opt.out = args[++i];
  else if (a === '--scale') opt.scale = +args[++i];
  else if (a === '--actions') opt.actions = JSON.parse(args[++i]);
  else if (a === '--audit') opt.audit = true;
}
if (!opt.url) { console.error('missing --url'); process.exit(2); }

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = mkdtempSync(join(tmpdir(), 'shoot-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-gpu', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port = null;
for (let i = 0; i < 100 && !port; i++) {
  await sleep(100);
  const f = join(dir, 'DevToolsActivePort');
  if (existsSync(f)) port = readFileSync(f, 'utf8').split('\n')[0].trim();
}
if (!port) { console.error('chrome did not start'); chrome.kill(); process.exit(1); }

const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const listeners = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
  else listeners.forEach((fn) => fn(d));
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const report = { url: opt.url, viewport: [opt.width, opt.height], console: [], exceptions: [], evals: [], shots: [] };
listeners.push((d) => {
  if (d.method === 'Runtime.consoleAPICalled') report.console.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 300));
  if (d.method === 'Runtime.exceptionThrown') report.exceptions.push((d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text || '').slice(0, 400));
  if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level)) report.console.push(`${d.params.entry.level}: ${d.params.entry.text} ${d.params.entry.url || ''}`.slice(0, 300));
});
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
const mobile = opt.width < 768;
await send('Emulation.setDeviceMetricsOverride', { width: opt.width, height: opt.height, deviceScaleFactor: opt.scale, mobile });
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const loaded = new Promise((r) => listeners.push((d) => { if (d.method === 'Page.loadEventFired') r(); }));
await send('Page.navigate', { url: opt.url });
await Promise.race([loaded, sleep(15000)]);
await sleep(600);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (path) => {
  let clip;
  if (opt.full) {
    const h = await evaluate('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)');
    await send('Emulation.setDeviceMetricsOverride', { width: opt.width, height: Math.min(h, 16000), deviceScaleFactor: opt.scale, mobile });
    await sleep(300);
    clip = { x: 0, y: 0, width: opt.width, height: Math.min(h, 16000), scale: 1 };
  }
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!opt.full, ...(clip ? { clip } : {}) });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
  report.shots.push(path);
  if (opt.full) await send('Emulation.setDeviceMetricsOverride', { width: opt.width, height: opt.height, deviceScaleFactor: opt.scale, mobile });
};
for (const a of opt.actions) {
  try {
    if (a.wait) await sleep(a.wait);
    if (a.waitFor) { for (let i = 0; i < 100; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(a.waitFor)})`)) break; await sleep(100); } }
    if (a.click) await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(a.click)}); if(!e) throw new Error('no element '+${JSON.stringify(a.click)}); e.scrollIntoView({block:'center'}); e.click(); return true})()`);
    if (a.type) await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(a.type[0])}); if(!e) throw new Error('no element'); e.focus(); const v=${JSON.stringify(a.type[1])}; const set=Object.getOwnPropertyDescriptor(e.__proto__,'value')?.set; set?set.call(e,v):(e.value=v); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true})()`);
    if (a.key) { const [mod, k] = a.key.includes('+') ? a.key.split('+') : [null, a.key]; const modifiers = mod === 'Meta' ? 4 : mod === 'Control' ? 2 : mod === 'Shift' ? 8 : 0; for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code: k === 'Enter' ? 'Enter' : k, windowsVirtualKeyCode: k === 'Enter' ? 13 : k === 'Escape' ? 27 : k === 'Tab' ? 9 : 0, modifiers }); }
    if (a.scroll !== undefined) await evaluate(`window.scrollTo(0, ${+a.scroll})`);
    if (a.eval) report.evals.push({ expr: a.eval.slice(0, 120), value: await evaluate(a.eval) });
    if (a.shot) await shot(a.shot);
  } catch (e) { report.exceptions.push(`action ${JSON.stringify(a).slice(0, 120)} failed: ${e.message}`); }
}
const layout = await evaluate(`(()=>{const W=innerWidth; const off=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect(); return r.width>0 && r.right>W+1 && getComputedStyle(e).position!=='fixed'}).slice(0,10).map(e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\\s+/).join('.'):'')+' right='+Math.round(e.getBoundingClientRect().right)); return {innerWidth:W, scrollWidth:document.documentElement.scrollWidth, scrollHeight:document.documentElement.scrollHeight, overflow:off, title:document.title}})()`);
Object.assign(report, layout);
if (opt.audit) {
  report.audit = await evaluate(`(()=>{
    // Colors are composited before measuring: the text color's alpha over its background, then every ancestor
    // opacity (an element dimmed with opacity mixes both its text and its own background into what is behind it).
    const parse=(c)=>{const m=c.match(/[\\d.]+/g).map(Number); return {r:m[0],g:m[1],b:m[2],a:m[3]===undefined?1:m[3]}};
    const mix=(f,b,a)=>({r:f.r*a+b.r*(1-a), g:f.g*a+b.g*(1-a), b:f.b*a+b.b*(1-a), a:1});
    const lin=(v)=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)};
    const Lof=(c)=>0.2126*lin(c.r)+0.7152*lin(c.g)+0.0722*lin(c.b);
    const css=(c)=>'rgb('+Math.round(c.r)+','+Math.round(c.g)+','+Math.round(c.b)+')';
    const WHITE={r:255,g:255,b:255,a:1};
    // nearest ancestor (or self) with a visible background; returns null when an image sits behind the text
    const bgFrom=(el)=>{for(let e=el;e;e=e.parentElement){const s=getComputedStyle(e); const b=s.backgroundColor; if(b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)){ const c=parse(b); if(c.a>0.5) return {el:e,c:c.a<1?mix(c,WHITE,c.a):c}; } if(s.backgroundImage && s.backgroundImage!=='none') return null;} return {el:null,c:WHITE}};
    const opBetween=(from,stop)=>{let o=1; for(let e=from;e&&e!==stop;e=e.parentElement) o*=+getComputedStyle(e).opacity; return o};
    const opFrom=(from)=>{let o=1; for(let e=from;e;e=e.parentElement) o*=+getComputedStyle(e).opacity; return o};
    const fails=[]; const seen=new Set();
    for(const el of document.querySelectorAll('body *')){
      if(!el.offsetParent && getComputedStyle(el).position!=='fixed') continue;
      const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ').trim(); if(!txt) continue;
      const s=getComputedStyle(el); if(s.visibility==='hidden' || +s.opacity===0) continue;
      const bgI=bgFrom(el); if(!bgI) continue;
      const fgC=parse(s.color);
      const opA=opBetween(el,bgI.el), opB=bgI.el?opFrom(bgI.el):1;
      if(opA*opB===0) continue;
      let fgE=mix(fgC,bgI.c,fgC.a*opA), bgE=bgI.c;
      if(opB<1){ const back=(bgI.el&&bgI.el.parentElement)?(bgFrom(bgI.el.parentElement)||{c:WHITE}).c:WHITE; fgE=mix(fgE,back,opB); bgE=mix(bgE,back,opB); }
      const fg={L:Lof(fgE)}, bg={L:Lof(bgE), c:css(bgE)};
      const ratio=(Math.max(fg.L,bg.L)+0.05)/(Math.min(fg.L,bg.L)+0.05);
      const size=parseFloat(s.fontSize); const bold=+s.fontWeight>=700; const large=size>=24 || (bold && size>=18.66);
      const need=large?3:4.5;
      if(ratio<need){ const key=s.color+'|'+bg.c+'|'+size; if(seen.has(key)) continue; seen.add(key); fails.push({text:txt.slice(0,40), color:s.color, bg:bg.c, size, weight:s.fontWeight, ratio:+ratio.toFixed(2), need}); }
    }
    const small=[...document.querySelectorAll('a,button,input,select,textarea,[role=button],label')].filter(e=>e.offsetParent).map(e=>{const r=e.getBoundingClientRect(); return {t:(e.innerText||e.value||e.getAttribute('aria-label')||e.tagName).trim().slice(0,30), w:Math.round(r.width), h:Math.round(r.height)}}).filter(x=>x.w<24||x.h<24);
    const noLabel=[...document.querySelectorAll('input,textarea,select,button')].filter(e=>e.offsetParent && !(e.labels&&e.labels.length) && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby') && !(e.tagName==='BUTTON' && e.innerText.trim())).length;
    return {contrastFailures:fails.slice(0,25), contrastFailureCount:fails.length, smallTapTargets:small.slice(0,15), smallTapTargetCount:small.length, unlabeledControls:noLabel, reducedMotionQuery: [...document.styleSheets].some(ss=>{try{return [...ss.cssRules].some(r=>r.media&&/prefers-reduced-motion/.test(r.media.mediaText))}catch(e){return false}})};
  })()`);
}
if (opt.out) await shot(opt.out);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill('SIGKILL'); await sleep(200); try { rmSync(dir, { recursive: true, force: true }); } catch {}
process.exit(0);
