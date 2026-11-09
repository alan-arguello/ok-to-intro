#!/usr/bin/env node
// node scripts/smoke.mjs [--base http://127.0.0.1:3200] [--online] [--only 1,2,3,4,6]
//
// The smoke test before every deploy and before the email (ux-spec §8 "Smoke test"), steps 1–4 and 6, driven through
// scripts/shoot.mjs (headless Chrome, one at a time). Owner: S7. Step 5 (a deployed live run watched with curl -N at the
// Vercel edge) needs a deploy and a key, so it isn't here.
//   1. / (the ask-first home) at 1280×900 and 375×812: the composer and its action (the one black pill) are in the
//      first viewport. /rules (the playground) at both sizes: the primary is in the first viewport; pressing it
//      resolves all 12 rows (an unedited preset renders its stored run at once: ≤ 1 s here, ≤ 6 s if it ran live).
//      Both: 0 console errors or exceptions; scrollWidth equals the viewport; 0 contrast failures.
//   2. / and /ask with the "Missing 2 parts" sample: Check, Use every suggestion and sample answer, Send; "Offered"
//      within 6 s.
//   3. /o/sample: OK to intro, then Send intro, and the intro-sent state. Then /c/sample?v=4 and /board render cleanly.
//   4. Every public page with ?degraded=down renders the banner, and on /rules the presets still run. ?degraded= is a QA
//      control, so this step runs where QA is on (any dev server, or QA_STATES=1 on a preview) and says SKIP elsewhere.
//   6. scripts/check-links.mjs (with --online: every external link must answer).
// Exits 1 if any step fails.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const base = opt('base', process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3200').replace(/\/+$/, '');
const only = new Set(opt('only', '1,2,3,4,6').split(',').map((s) => s.trim()));
const online = args.includes('--online');

function run(cmd, cmdArgs) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [cmd, ...cmdArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

async function shoot(path, { width = 1280, height = 900, actions = [], audit = false } = {}) {
  const a = ['--url', `${base}${path}`, '--width', String(width), '--height', String(height), '--actions', JSON.stringify(actions)];
  if (audit) a.push('--audit');
  const r = await run(join(root, 'scripts', 'shoot.mjs'), a);
  try {
    return JSON.parse(r.out);
  } catch {
    return { error: (r.out || r.err).slice(0, 300), console: [], exceptions: ['no report'], evals: [], overflow: [], scrollWidth: 0, innerWidth: width };
  }
}

const results = [];
function check(step, name, ok, detail = '') {
  results.push({ step, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step} · ${name}${detail ? ` · ${detail}` : ''}`);
}

// Errors and warnings, minus favicon noise and Chrome's “preloaded but not used” hint for CSS that a <Link> prefetch
// preloads in production (a framework behaviour, not a page error; docs/requests/s7-site.md item 7).
const errorsOf = (r) =>
  (r.console || []).filter((l) => /^(error|warning|warn|assert):/.test(l) && !/favicon/.test(l) && !/was preloaded using link preload but not used/.test(l));
const evalOf = (r, i = 0) => {
  try {
    return JSON.parse(r.evals[i].value);
  } catch {
    return null;
  }
};

/** In-page helpers shared by the steps (a string: shoot.mjs evaluates expressions). */
const HELPERS = `
  const sleep=(ms)=>new Promise((r)=>setTimeout(r,ms));
  const vis=(e)=>{if(!e)return false;const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!e.closest('[hidden]')};
  const until=async(fn,ms)=>{const t0=performance.now();while(performance.now()-t0<ms){const v=fn();if(v)return v;await sleep(25);}return null};
  const resolvedRows=()=>{const rows=[...document.querySelectorAll('.row[id^="pg-row-"]')];return {rows:rows.length,done:rows.filter((r)=>{const v=r.querySelector('.verdict');return v&&!/verdict--(notrun|checking)/.test(v.className)}).length}};
`;

/** Presses the first visible [data-primary] on /rules and waits for 12 resolved rows. */
const RUN_PLAYGROUND = `(async()=>{${HELPERS}
  const p=[...document.querySelectorAll('[data-primary]')].find(vis);
  if(!p) return JSON.stringify({ok:false, why:'no visible [data-primary]'});
  const box=p.getBoundingClientRect();
  const label=p.innerText.trim().replace(/\\s+/g,' ');
  const before=resolvedRows();
  const t0=performance.now();
  p.click();
  const got=await until(()=>{const r=resolvedRows();return r.rows===12&&r.done===12?r:null},6000);
  const ms=Math.round(performance.now()-t0);
  return JSON.stringify({ok:!!got, ms, primary:label, bottom:Math.round(box.bottom), height:Math.round(box.height), innerHeight, before, after:resolvedRows()});
})()`;

/** The home composer: the textarea and its action in the first viewport, and the number of black pills in view. */
const HOME_PROBE = `JSON.stringify((()=>{${HELPERS}
  const t=document.querySelector('#ask-text'); const b=document.querySelector('#ask-check');
  const pills=[...document.querySelectorAll('.btn--primary')].filter((e)=>{const r=e.getBoundingClientRect();return vis(e)&&r.bottom>0&&r.top<innerHeight}).length;
  return {text:t?Math.round(t.getBoundingClientRect().bottom):null, action:b?Math.round(b.getBoundingClientRect().bottom):null, label:b?b.innerText.trim().replace(/\\s+/g,' '):null, primary:!!b&&b.hasAttribute('data-primary'), pills, innerHeight};
})())`;

async function step1() {
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    const at = `${width}×${height}`;
    const h = await shoot('/', { width, height, audit: true, actions: [{ eval: HOME_PROBE }] });
    const hv = evalOf(h);
    check('1', `/ ${at}: the composer and its action are in the first viewport`, !!hv && hv.text !== null && hv.action !== null && hv.text <= hv.innerHeight && hv.action <= hv.innerHeight && hv.primary, hv ? `“${hv.label}” bottom ${hv.action}, textarea bottom ${hv.text} of ${hv.innerHeight}` : h.error || 'no probe');
    check('1', `/ ${at}: one black pill in view`, hv?.pills === 1, hv ? `${hv.pills}` : '');
    check('1', `/ ${at}: no console errors or exceptions`, !errorsOf(h).length && !h.exceptions.length, [...errorsOf(h), ...h.exceptions].join(' | ').slice(0, 200));
    check('1', `/ ${at}: no sideways scroll`, h.scrollWidth === h.innerWidth && !h.overflow.length, `scrollWidth ${h.scrollWidth}`);
    check('1', `/ ${at}: no contrast failures`, (h.audit?.contrastFailureCount ?? 1) === 0, h.audit ? `${h.audit.contrastFailureCount}` : 'no audit');

    // The wait lets the 260 ms row flash and the 200 ms re-sort finish, so the audit measures settled colours.
    const r = await shoot('/rules', { width, height, audit: true, actions: [{ eval: RUN_PLAYGROUND }, { wait: 700 }] });
    const ev = evalOf(r);
    check('1', `/rules ${at}: the primary is in the first viewport`, !!ev && ev.bottom <= ev.innerHeight, ev ? `“${ev.primary}” bottom ${ev.bottom} of ${ev.innerHeight}` : r.error || 'no probe');
    check('1', `/rules ${at}: pressing it resolves 12 rows`, !!ev?.ok && ev.ms <= 6000, ev ? `${ev.after.done} of ${ev.after.rows} in ${ev.ms} ms` : '');
    if (ev?.ok && ev.ms > 1000) console.log(`     note: ${ev.ms} ms is slower than an unedited preset should be (≤ 100 ms target)`);
    check('1', `/rules ${at}: no console errors or exceptions`, !errorsOf(r).length && !r.exceptions.length, [...errorsOf(r), ...r.exceptions].join(' | ').slice(0, 200));
    check('1', `/rules ${at}: no sideways scroll`, r.scrollWidth === r.innerWidth && !r.overflow.length, `scrollWidth ${r.scrollWidth}`);
    check('1', `/rules ${at}: no contrast failures`, (r.audit?.contrastFailureCount ?? 1) === 0, r.audit ? `${r.audit.contrastFailureCount}` : 'no audit');
  }
}

const ASK_FLOW = `(async()=>{${HELPERS}
  const chip=document.querySelector('[data-sample="partial"]');
  if(!chip) return JSON.stringify({ok:false, why:'no “Missing 2 parts” chip'});
  chip.click(); await sleep(150);
  const checkBtn=document.querySelector('#ask-check');
  if(!checkBtn) return JSON.stringify({ok:false, why:'no Check button'});
  checkBtn.click();
  const parts=await until(()=>document.querySelector('#ask-parts .ask-part, [data-use], [data-sample-answer]'),15000);
  if(!parts) return JSON.stringify({ok:false, why:'the parts never appeared'});
  for(let i=0;i<12;i++){const b=[...document.querySelectorAll('[data-use], [data-sample-answer]')].find(vis); if(!b) break; b.click(); await sleep(200);}
  const send=await until(()=>{const s=document.querySelector('#ask-send'); return s&&vis(s)&&s.getAttribute('aria-disabled')!=='true'?s:null},5000);
  if(!send) return JSON.stringify({ok:false, why:'Send stayed disabled', text:(document.querySelector('#ask-actions-meta')||{}).textContent||''});
  const t0=performance.now();
  send.click();
  const offered=await until(()=>{const t=(document.querySelector('#st-outcome')||document.querySelector('main')||document.body).innerText; return location.pathname.startsWith('/ask/sa_')&&/offered/i.test(t)?true:null},6000);
  return JSON.stringify({ok:!!offered, ms:Math.round(performance.now()-t0), path:location.pathname, outcome:((document.querySelector('#st-outcome')||{}).innerText||'').slice(0,120)});
})()`;

async function step2() {
  for (const path of ['/', '/ask']) {
    const r = await shoot(path, { actions: [{ eval: ASK_FLOW }] });
    const ev = evalOf(r);
    check('2', `${path} “Missing 2 parts”: Check, Use, Send → Offered within 6 s`, !!ev?.ok, ev ? (ev.ok ? `${ev.path} in ${ev.ms} ms` : ev.why || `no “Offered” (${ev.path}): ${ev.outcome}`) : r.error || 'no probe');
    check('2', `${path}: no console errors or exceptions`, !errorsOf(r).length && !r.exceptions.length, [...errorsOf(r), ...r.exceptions].join(' | ').slice(0, 200));
  }
}

const OFFER_FLOW = `(async()=>{${HELPERS}
  const ok=await until(()=>[...document.querySelectorAll('[data-key="ok"]')].find(vis),5000);
  if(!ok) return JSON.stringify({ok:false, why:'no OK to intro button'});
  ok.click();
  const send=await until(()=>[...document.querySelectorAll('[data-send]')].find(vis),5000);
  if(!send) return JSON.stringify({ok:false, why:'no Send intro button after OK'});
  send.click();
  const done=await until(()=>{const h=document.querySelector('#offer-done-h'); return h&&/Intro sent/.test(h.textContent)?h.textContent:null},8000);
  return JSON.stringify({ok:!!done, head:done||((document.querySelector('main')||{}).innerText||'').slice(0,120)});
})()`;

async function step3() {
  const r = await shoot('/o/sample', { width: 375, height: 812, actions: [{ eval: OFFER_FLOW }] });
  const ev = evalOf(r);
  check('3', '/o/sample: OK to intro → Send intro → intro sent', !!ev?.ok, ev ? ev.head || ev.why : r.error || 'no probe');
  check('3', '/o/sample: no console errors or exceptions', !errorsOf(r).length && !r.exceptions.length, [...errorsOf(r), ...r.exceptions].join(' | ').slice(0, 200));
  for (const path of ['/c/sample?v=4', '/board']) {
    const p = await shoot(path, { audit: true, actions: [{ eval: `JSON.stringify({h1:(document.querySelector('h1')||{}).textContent||null})` }] });
    const h = evalOf(p);
    const clean = !errorsOf(p).length && !p.exceptions.length && p.scrollWidth === p.innerWidth && (p.audit?.contrastFailureCount ?? 1) === 0;
    check('3', `${path}: renders cleanly`, !!h?.h1 && clean, h?.h1 ? `“${h.h1}”${clean ? '' : ` · ${[...errorsOf(p), ...p.exceptions].join(' | ').slice(0, 160)}`}` : 'no h1');
  }
}

const PUBLIC = ['/', '/rules', '/ask', '/board', '/agents', '/how', '/privacy', '/join', '/o/sample', '/c/sample'];
const BANNER = `JSON.stringify((()=>{const b=document.querySelector('[data-banner]'); return {shown:!!b&&!b.hidden, text:b?b.textContent.trim():''}})())`;

async function step4() {
  // ?degraded= is a QA control (lib/qa.ts): a production deployment ignores it. /kit answers only when QA is on.
  let qa = false;
  try {
    qa = (await fetch(`${base}/kit`, { signal: AbortSignal.timeout(60_000) })).status === 200;
  } catch {
    qa = false;
  }
  if (!qa) {
    console.log('SKIP 4 · ?degraded= needs QA states (a dev server, or QA_STATES=1 on a preview); this instance ignores it');
    return;
  }
  for (const path of PUBLIC) {
    const actions = [{ eval: BANNER }];
    if (path === '/rules') actions.push({ eval: RUN_PLAYGROUND });
    const r = await shoot(`${path}${path.includes('?') ? '&' : '?'}degraded=down`, { actions });
    const b = evalOf(r, 0);
    const shown = !!b?.shown && /Live checks are paused/.test(b.text);
    const clean = !errorsOf(r).length && !r.exceptions.length;
    check('4', `${path}?degraded=down: banner shown, page renders`, shown && clean, shown ? (clean ? '' : [...errorsOf(r), ...r.exceptions].join(' | ').slice(0, 160)) : `banner: ${b ? JSON.stringify(b.text).slice(0, 80) : 'none'}`);
    if (path === '/rules') {
      const ev = evalOf(r, 1);
      check('4', '/rules?degraded=down: presets still run', !!ev?.ok, ev ? `${ev.after.done} of ${ev.after.rows} in ${ev.ms} ms` : 'no probe');
    }
  }
}

async function step6() {
  const r = await run(join(root, 'scripts', 'check-links.mjs'), ['--base', base, ...(online ? ['--online'] : [])]);
  const tail = r.out.trim().split('\n').filter((l) => /^FAIL|problem|no problems/.test(l));
  check('6', `check-links${online ? ' --online' : ''}`, r.code === 0, tail.slice(-6).join(' · ').slice(0, 400));
}

try {
  const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
  if (!h.ok) throw new Error(String(h.status));
} catch {
  console.error(`${base} isn't answering. Start the server (docs/CONTRACT.md §0) or pass --base.`);
  process.exit(2);
}
const started = Date.now();
if (only.has('1')) await step1();
if (only.has('2')) await step2();
if (only.has('3')) await step3();
if (only.has('4')) await step4();
if (only.has('6')) await step6();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length} of ${results.length} checks passed in ${Math.round((Date.now() - started) / 1000)} s against ${base}`);
process.exit(failed.length ? 1 : 0);
