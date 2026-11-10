#!/usr/bin/env node
// node scripts/audit-sweep.mjs [--base http://127.0.0.1:3200] [--filter text] [--jobs 1] [--widths 1280,375]
//                              [--json .shots/audit-sweep.json] [--shots .shots/sweep] [--list]
//
// Runs scripts/shoot.mjs --audit on every route and every QA state (lib/qa.ts QA_STATES, kept in sync by
// tests/site/scripts.test.ts) at 1280×900 and 375×812, then prints one line per run and a total. Owner: S7.
// A run fails on: an exception, a console error or warning, horizontal overflow, a contrast failure, an unlabeled
// control, more than one black pill in view, or a [data-primary] that is under 44 px or below the first viewport
// (ux-spec §2 principles 1–2, §9). Small tap targets are listed, not failed (inline links and labels are allowed).
// QA states need QA on (any dev server, or QA_STATES=1). Exits 1 if any run fails. One Chrome per job: keep --jobs low
// on a shared machine.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const base = opt('base', process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3200').replace(/\/+$/, '');
const filter = opt('filter', '');
const jobsN = Math.max(1, Number(opt('jobs', '1')) || 1);
const widths = opt('widths', '1280,375').split(',').map(Number).filter(Boolean);
const jsonOut = opt('json', join(root, '.shots', 'audit-sweep.json'));
const shotsDir = opt('shots', '');

/** lib/qa.ts QA_STATES (tests/site/scripts.test.ts fails if the two differ). */
export const QA = {
  home: ['default'],
  playground: ['not-run', 'running', 'done-recorded', 'done-live', 'stale', 'cap-changed', 'partial-timeout', 'empty-rules', 'too-long', 'all-declined', 'all-accepted', 'rate-limited', 'api-down', 'budget', 'lost-stream', 'offline'],
  ask: ['empty', 'filled', 'compiling', 'compiled', 'ready', 'refused-vague', 'refused-yc', 'compiler-slow', 'compiler-down'],
  askStatus: ['offered', 'streaming', 'offered-you', 'ask-back', 'answered', 'intro', 'moved-on', 'no-match', 'closed-all-passed', 'expired-deadline', 'failed-closed', 'partial-failure', 'withdrawn', 'real'],
  board: ['default', 'launch-day', 'small-n', 'stale'],
  offer: ['open', 'confirm-ok', 'answer', 'ok-sent', 'answer-sent', 'no-done', 'no-reason-diff', 'no-reason-busy', 'diff-applied', 'already-acted', 'expired', 'withdrawn', 'paused-member', 'invalid', 'post-failed', 'sample'],
  checkin: ['d1-preselected', 'd1-saved', 'd1-notyet', 'd1-wont', 'member-d1', 'd14-preselected', 'd14-saved', 'already-answered', 'closed', 'invalid', 'save-failed'],
  join: ['email', 'email-carried', 'email-invalid', 'code', 'code-wrong', 'code-expired', 'code-limited', 'code-delayed', 'resend-ready'],
  me: ['on', 'first', 'offer-pending', 'paused', 'dirty', 'saved', 'save-failed', 'token-created', 'token-revoked', 'delete-confirm', 'deleted', 'empty-ledger', 'signed-out'],
  pause: ['confirm', 'paused', 'post-failed'],
  agents: ['default'],
  how: ['default'],
  privacy: ['default'],
  notFound: ['default'],
  error: ['default'],
};

/** Where each QA page lives. `status` is the document status the page should answer with. */
export const PAGES = {
  // `/` is the ask-first home (static); the playground moved to /rules on Nov 9.
  home: { path: '/' },
  playground: { path: '/rules' },
  ask: { path: '/ask' },
  askStatus: { path: '/ask/sa_eng' },
  board: { path: '/board' },
  offer: { path: '/o/sample' },
  checkin: { path: '/c/sample' },
  join: { path: '/join' },
  me: { path: '/me' },
  // QA states render without looking the token up.
  pause: { path: '/pause/qa-sweep-token-0000' },
  agents: { path: '/agents' },
  how: { path: '/how' },
  privacy: { path: '/privacy' },
  notFound: { path: '/qa-sweep-not-found', status: 404 },
  // The error page's view without a thrown error (QA only; app/(site)/how/error-preview).
  error: { path: '/how/error-preview' },
};

const EMAIL_KINDS = ['offer', 'intro', 'checkin-1d', 'checkin-14d', 'question', 'outcome-note', 'code'];
const DEGRADED = ['slow', 'down', 'budget', 'limited', 'offline', 'off'];

export function sweepUrls() {
  const urls = [];
  for (const [key, page] of Object.entries(PAGES)) {
    const states = QA[key] ?? [];
    urls.push({ path: page.path, status: page.status ?? 200 });
    // A page whose only state is "default" has nothing else to show; the board's "default" is its example state.
    if (!(states.length === 1 && states[0] === 'default')) for (const s of states) urls.push({ path: `${page.path}?state=${s}`, status: page.status ?? 200 });
    if (key !== 'notFound' && key !== 'error') urls.push({ path: `${page.path}?degraded=down`, status: page.status ?? 200 });
  }
  // Every degraded mode on the two pages that run live model calls: the playground and the home composer.
  for (const d of DEGRADED) if (d !== 'down') urls.push({ path: `/rules?degraded=${d}`, status: 200 }, { path: `/?degraded=${d}`, status: 200 });
  for (const k of EMAIL_KINDS) urls.push({ path: `/emails/${k}`, status: 200 }, { path: `/emails/${k}?v=text`, status: 200 });
  urls.push({ path: '/kit', status: 200 });
  return urls;
}

const PROBE = `JSON.stringify((()=>{
  const vis=(e)=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&s.visibility!=='hidden'&&!e.closest('[hidden]')};
  const pills=[...document.querySelectorAll('.btn--primary')].filter(vis).length;
  const p=[...document.querySelectorAll('[data-primary]')].filter((e)=>(e.offsetWidth||e.offsetHeight)&&!e.closest('[hidden]'))[0];
  const r=p&&p.getBoundingClientRect();
  return {pills, primary:p?(p.innerText||'').trim().replace(/\\s+/g,' ').slice(0,30):null, pBottom:r?Math.round(r.bottom):null, pH:r?Math.round(r.height):null, h1:(document.querySelector('h1')||{}).textContent||null};
})())`;

function shoot(url, w, h, out) {
  return new Promise((resolve) => {
    const cmd = [join(root, 'scripts', 'shoot.mjs'), '--url', url, '--width', String(w), '--height', String(h), '--audit', '--actions', JSON.stringify([{ eval: PROBE }])];
    if (out) cmd.push('--out', out);
    const c = spawn(process.execPath, cmd, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.on('close', () => {
      try {
        resolve({ report: JSON.parse(stdout) });
      } catch {
        resolve({ error: stdout.slice(0, 300) || 'no report' });
      }
    });
  });
}

/**
 * Chrome's hint that a stylesheet was preloaded and not applied within a few seconds. In production, every visible
 * <Link> prefetches its route, and the prefetched payload preloads that route's CSS on the current page: a framework
 * behaviour, not a page error (docs/requests/s7-site.md item 7).
 */
export const PREFETCH_PRELOAD_HINT = /was preloaded using link preload but not used within a few seconds/;

/** Console lines that are failures: errors and warnings, minus the expected ones. */
export function consoleIssues(lines, { status }) {
  return lines.filter((l) => {
    if (!/^(error|warning|warn|assert):/.test(l)) return false;
    if (/favicon/.test(l)) return false;
    if (PREFETCH_PRELOAD_HINT.test(l)) return false;
    if (status === 404 && /status of 404/.test(l)) return false; // the 404 page's own document status
    return true;
  });
}

export function issuesOf(report, ev, { status, height, kit = false }) {
  const issues = [];
  const a = report.audit || {};
  if (report.exceptions.length) issues.push(`EXCEPTION ${report.exceptions.join(' | ').slice(0, 200)}`);
  const cons = consoleIssues(report.console, { status });
  if (cons.length) issues.push(`CONSOLE ${cons.join(' | ').slice(0, 200)}`);
  if (report.overflow.length || report.scrollWidth > report.innerWidth) issues.push(`OVERFLOW ${report.scrollWidth} ${report.overflow.join(',')}`.trim());
  if (a.contrastFailureCount) issues.push(`CONTRAST ${a.contrastFailures.map((f) => `${f.text.slice(0, 20)}=${f.ratio}`).join('; ')}`);
  if (a.unlabeledControls) issues.push(`UNLABELED ${a.unlabeledControls}`);
  // /kit is the component gallery: it shows every button variant on purpose.
  if (ev.pills > 1 && !kit) issues.push(`PILLS ${ev.pills}`);
  if (ev.primary !== null && ev.pH !== null && ev.pH < 44) issues.push(`PRIMARY ${ev.pH}px < 44`);
  if (ev.primary !== null && ev.pBottom !== null && ev.pBottom > height) issues.push(`PRIMARY below the fold (${ev.pBottom} > ${height})`);
  return issues;
}

async function main() {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    console.error(`${base} isn't answering. Start the dev server (docs/CONTRACT.md §0) or pass --base.`);
    process.exit(2);
  }
  const urls = sweepUrls().filter((u) => u.path.includes(filter));
  const jobs = [];
  for (const u of urls) for (const w of widths) jobs.push({ ...u, w, h: w >= 768 ? 900 : 812 });
  if (args.includes('--list')) {
    for (const j of jobs) console.log(j.w, j.path);
    console.log(`${jobs.length} runs`);
    return;
  }
  if (shotsDir) mkdirSync(shotsDir, { recursive: true });
  const results = [];
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (next < jobs.length) {
      const idx = next++;
      const j = jobs[idx];
      const out = shotsDir ? join(shotsDir, `${j.path.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'home'}-${j.w}.png`) : null;
      const res = await shoot(`${base}${j.path}`, j.w, j.h, out);
      results.push({ ...j, idx, ...res });
      const done = results.length;
      if (done % 20 === 0) process.stderr.write(`${done}/${jobs.length} runs…\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobsN, jobs.length) }, worker));
  results.sort((a, b) => a.idx - b.idx);
  let bad = 0;
  const rows = [];
  for (const x of results) {
    if (x.error) {
      bad++;
      rows.push({ path: x.path, w: x.w, ok: false, issues: [`NO REPORT ${x.error}`] });
      console.log(`FAIL ${String(x.w).padEnd(4)} ${x.path} | NO REPORT ${x.error}`);
      continue;
    }
    let ev = { pills: 0, primary: null, pBottom: null, pH: null, h1: null };
    try {
      ev = JSON.parse(x.report.evals[0].value);
    } catch {
      /* the probe failed: the exception is in the report */
    }
    const issues = issuesOf(x.report, ev, { status: x.status, height: x.h, kit: x.path.startsWith("/kit") });
    if (issues.length) bad++;
    const small = x.report.audit?.smallTapTargetCount ?? 0;
    rows.push({ path: x.path, w: x.w, ok: !issues.length, issues, primary: ev.primary, pBottom: ev.pBottom, pH: ev.pH, small, title: x.report.title });
    const prim = ev.primary ? `${ev.primary} (${ev.pH}px, bottom ${ev.pBottom})` : '–';
    console.log(`${issues.length ? 'FAIL' : 'ok  '} ${String(x.w).padEnd(4)} ${x.path.padEnd(44)} primary: ${prim}${small ? ` · ${small} small targets` : ''}${issues.length ? ` | ${issues.join(' || ')}` : ''}`);
  }
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify({ base, ran_at: new Date().toISOString(), runs: rows }, null, 1));
  console.log(`${results.length} runs, ${bad} failed, ${Math.round((Date.now() - started) / 1000)} s · ${jsonOut}`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
