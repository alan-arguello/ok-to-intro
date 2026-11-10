/**
 * S3 views: static markup of /join, /me (SAMPLE preview states) and /pause, plus the copy helpers. Server actions
 * and the router are stubbed: these tests check what renders, what works without JS, and what never ships.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/me',
}));
vi.mock('@/app/(site)/join/actions', () => ({ sendCode: vi.fn(), verifyCode: vi.fn() }));
vi.mock('@/app/(site)/me/actions', () => ({
  saveSettingsAction: vi.fn(),
  turnOnAction: vi.fn(),
  pauseAction: vi.fn(),
  resumeAction: vi.fn(),
  createTokenAction: vi.fn(),
  revokeTokenAction: vi.fn(),
  deleteAction: vi.fn(),
}));

import {
  capStatusLine,
  carriedMeta,
  codesLimited,
  codeWrong,
  effectiveStatus,
  JOIN_COPY,
  ledgerHelp,
  ledgerLine,
  ME_COPY,
  mmss,
  PAUSE_COPY,
  pauseChipLabel,
  pausedUntilLabel,
  pausePhrase,
  pauseUntil,
  tallyText,
  timeLabelText,
  triesLimited,
} from '@/components/member/copy';
import { parseCarried } from '@/components/member/hooks';
import { JoinView } from '@/components/member/join-view';
import { sampleMe, SAMPLE_TOKEN } from '@/components/member/me-sample';
import { MeView } from '@/components/member/me-view';
import { pauseErrorText, pauseViewState } from '@/components/member/pause-state';
import { PauseView } from '@/components/member/pause-view';
import { QA_STATES } from '@/lib/qa';
import { BANNED_COPY } from '@/lib/oti/text';
import { NETWORK_TZ, zonedTimeToUtc } from '@/lib/oti/time';

const NOV9 = zonedTimeToUtc(2026, 11, 9, 10, 15, NETWORK_TZ);
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('copy', () => {
  it('ledger lines and their empty states read as the spec writes them', () => {
    const full = { reached_gate: 23, reached_you: 1, declined: 21, failed: 0, no_line: 16, old_lines: 0 };
    expect(ledgerLine(full, 2)).toBe('23 asks reached your gate · 1 reached you · 22 stopped. You never see the stopped asks; neither does anyone else.');
    expect(ledgerHelp(full)).toBe('16 asks matched no line and were declined.');
    expect(ledgerLine({ ...full, reached_gate: 6, reached_you: 0, declined: 6 }, 2)).toBe('Your gate checked 6 asks this month and declined all 6. None reached you.');
    expect(ledgerLine({ ...full, reached_gate: 0, reached_you: 0 }, 2)).toBe('Nothing has reached you yet. With cap 2, at most 2 asks a month will.');
    expect(ledgerLine({ ...full, reached_gate: 0, reached_you: 0 }, 1)).toBe('Nothing has reached you yet. With cap 1, at most 1 ask a month will.');
    expect(ledgerHelp({ ...full, no_line: 1, old_lines: 2, failed: 1 })).toBe(
      '1 ask matched no line and was declined. 2 quoted lines you’ve since changed. 1 wasn’t checked because the gate failed; that never counts as an accept.',
    );
    expect(tallyText({ accept: 1, ask_back: 1, decline: 3 })).toBe('1 let in · 1 question · 3 kept out');
    expect(tallyText({ accept: 0, ask_back: 2, decline: 0 })).toBe('2 questions');
    expect(tallyText({ accept: 0, ask_back: 0, decline: 0 })).toBe('not used this month');
  });

  it('sign-in copy: tries, timers, the carried card', () => {
    expect(codeWrong(4)).toBe('That code didn’t match. 4 tries left.');
    expect(codeWrong(1)).toBe('That code didn’t match. 1 try left.');
    expect(codeWrong(0)).toBe('That code didn’t match. No tries left.');
    expect(codesLimited('10:40')).toBe('Too many codes requested. Try again at 10:40.');
    expect(triesLimited('10:40')).toBe('Too many tries. Try again at 10:40.');
    expect(JOIN_COPY.triesLimited).toBe('Too many tries. Try again in a few minutes.');
    expect([mmss(47), mmss(31), mmss(0), mmss(60)]).toEqual(['0:47', '0:31', '0:00', '1:00']);
    expect(carriedMeta('a\nb\n\nc\nd', 2, 'Engineer')).toBe('4 lines · cap 2 · Engineer');
  });

  it('pause labels: chips, titles and the paused status, in Pacific-time dates', () => {
    expect(pauseChipLabel('2w', NOV9)).toBe('2 weeks');
    expect(pauseChipLabel('month', NOV9)).toBe('Until Dec 1');
    expect(pauseChipLabel('off', NOV9)).toBe('Until I turn it back on');
    expect(pausePhrase('month', NOV9)).toBe('until Dec 1');
    expect(pausePhrase('off', NOV9)).toBe('until you turn them back on');
    expect(pausedUntilLabel(pauseUntil('2w', NOV9))).toBe('Until Nov 23');
    expect(pausedUntilLabel(pauseUntil('month', NOV9))).toBe('Until Dec 1');
    expect(pausedUntilLabel(null)).toBe('Until you turn it back on');
    expect(capStatusLine(2, 1, '2026-11-01')).toBe('Cap 2 a month · 1 of 2 used in November · resets Dec 1');
    expect(effectiveStatus('paused', new Date(NOV9 - 1000).toISOString(), NOV9)).toEqual({ status: 'on', paused_until: null });
    expect(timeLabelText('last', NOV9 - 3_600_000, NOV9, NETWORK_TZ)).toBe('09:15');
    expect(timeLabelText('last', NOV9 - 86_400_000, NOV9, NETWORK_TZ)).toBe('Nov 8, 10:15');
  });

  it('every S3 string is curly-quoted and free of banned words', () => {
    const all = [...Object.values(JOIN_COPY), ...Object.values(ME_COPY), ...Object.values(PAUSE_COPY)];
    for (const s of all) {
      for (const re of BANNED_COPY) expect(s, s).not.toMatch(re);
      expect(s, s).not.toMatch(/["']/);
    }
  });

  it('reads the playground store defensively', () => {
    expect(parseCarried(null)).toBeNull();
    expect(parseCarried('{bad json')).toBeNull();
    expect(parseCarried(JSON.stringify({ v: 2, rules: 'x' }))).toBeNull();
    expect(parseCarried(JSON.stringify({ v: 1, rules: '  ' }))).toBeNull();
    expect(parseCarried(JSON.stringify({ v: 1, rules: 'Happy to help.', cap: 9, preset: 'nope' }))).toEqual({ rules: 'Happy to help.', cap: 2, preset: 'engineer', label: 'Custom' });
  });
});

describe('/join', () => {
  it('without Supabase on this instance: the designed state, no form', () => {
    const out = html(<JoinView available={false} qa={false} />);
    expect(out).toContain('Sign-in isn’t set up on this instance.');
    expect(out).toContain('Try the playground');
    expect(out).not.toContain('<form');
    expect(out).not.toContain('Nothing is stored');
  });

  it('with Supabase: one email input (autocomplete email), one primary, and the 6-digit code input ready', () => {
    const out = html(<JoinView available qa={false} />);
    expect(out).toContain('<h1 class="title" id="join-title">Sign in</h1>');
    expect(out).toContain('We email you a 6-digit code. No password.');
    expect(out).toMatch(/<input[^>]*autocomplete="email"/i);
    expect(out).toMatch(/<input[^>]*inputmode="numeric"[^>]*autocomplete="one-time-code"[^>]*maxlength="6"/i);
    expect(out.match(/data-primary=""/g)?.length).toBe(2); // Send code, and Verify in the hidden code step
    expect(out).not.toContain('Nothing is stored');
    expect(out).not.toMatch(/magic link/i);
  });
});

describe('/me (SAMPLE preview, QA states only)', () => {
  it('on: the dashed note, the ledger on the read view, settings with the asker profile, token, data', () => {
    const out = html(<MeView initial={sampleMe('on', NOV9)} />);
    expect(out).toContain(ME_COPY.protoNote);
    expect(out).toContain('Cap 2 a month · 1 of 2 used in November · resets Dec 1');
    expect(out).toContain('1 let in · 1 question · 3 kept out');
    expect(out).toContain('<mark class="mark">B2B founders selling to public hospitals or insurers in the US or Canada</mark>');
    expect(out).toContain('16 asks matched no line and were declined.');
    expect(out).toContain('Saved 21:14 · version 3');
    expect(out).toContain('When you ask, the member who gets it sees “Priya Shah · Oakline Health · Seed · Chicago”.');
    expect(out).toContain('Token created Nov 9 · last used 21:04 from Claude Code');
    for (const anchor of ['id="asks"', 'id="settings"', 'id="token"', 'id="delete"']) expect(out).toContain(anchor);
    // The guest path is cut (ux-spec §10 “Later”), so its toggle doesn't ship.
    expect(out).not.toContain('guest');
    expect(out).not.toContain('Accept verified');
  });

  it('first: the Finish block, gate off, Turn on my gate on desktop and in the phone bar', () => {
    const out = html(<MeView initial={sampleMe('first', NOV9)} />);
    expect(out).toContain('Not on yet');
    expect(out).toContain('Health operator preset');
    expect(out.match(/Turn on my gate/g)?.length).toBe(2);
    expect(out).not.toContain(ME_COPY.protoNote);
    expect(out).not.toContain('id="token"');
  });

  it('paused, offer-pending, empty-ledger, token states and deleted', () => {
    expect(html(<MeView initial={sampleMe('paused', NOV9)} />)).toContain('Until Dec 1 · offers go to others');
    const pending = html(<MeView initial={sampleMe('offer-pending', NOV9)} />);
    expect(pending).toContain('1 ask is waiting on you');
    expect(pending).toContain(' · Hospital procurement in the US · from Maya Bennett · 61 h left');
    expect(html(<MeView initial={sampleMe('empty-ledger', NOV9)} />)).toContain('Your gate checked 6 asks this month and declined all 6. None reached you.');
    const created = html(<MeView initial={sampleMe('token-created', NOV9)} />);
    expect(created).toContain(SAMPLE_TOKEN);
    expect(created).toContain('Copy it now. It won’t be shown again.');
    expect(created).toContain('claude plugin configure ok-to-intro');
    expect(html(<MeView initial={sampleMe('token-revoked', NOV9)} />)).toContain('Revoked. Claude Code can no longer send or answer for you.');
    expect(html(<MeView initial={sampleMe('delete-confirm', NOV9)} />)).toContain('Delete your rules, cap, offers and check-ins now?');
    const gone = html(<MeView initial={sampleMe('deleted', NOV9)} />);
    expect(gone).toContain('Deleted.');
    expect(gone).toContain('Board counts stay, without your name.');
  });

  it('paused with an offer that arrived before the pause: still listed, and Resume stays the one black pill', () => {
    const out = html(<MeView initial={{ ...sampleMe('paused', NOV9), pending: sampleMe('offer-pending', NOV9).pending }} />);
    expect(out).toContain('1 ask is waiting on you');
    // Black pills: enabled .btn--primary (the settings Save is aria-disabled until there are changes: chip fill).
    expect(out.match(/class="btn btn--primary"(?![^>]*aria-disabled="true")[^>]*>/g)?.length).toBe(1);
    expect(out).toMatch(/<button[^>]*class="btn btn--primary"[^>]*id="me-resume"/);
    expect(out).toMatch(/<a (?=[^>]*class="btn")(?=[^>]*href="\/o\/sample")[^>]*>Review the ask<\/a>/);
  });

  it('dirty and save-failed: the one Save lives in the sticky bar', () => {
    const dirty = html(<MeView initial={sampleMe('dirty', NOV9)} />);
    expect(dirty).toContain('id="me-bar"');
    expect(dirty).toContain('Unsaved changes');
    const failed = html(<MeView initial={sampleMe('save-failed', NOV9)} />);
    expect(failed).toContain('Didn’t save. Your changes are still here.');
    expect(failed).toContain('>Retry');
  });

  it('every QA state renders', () => {
    for (const state of QA_STATES.me) {
      if (state === 'signed-out') continue;
      expect(() => html(<MeView initial={sampleMe(state, NOV9)} />), state).not.toThrow();
    }
  });
});

describe('/pause/[token]', () => {
  it('works without JS: a plain POST to /api/pause with the token, chips that preselect with a GET', () => {
    const out = html(<PauseView token="AAAAAAAAAAAAAAAAAAAAAA" sample={false} nowMs={NOV9} initial={{ kind: 'confirm', choice: 'month', error: null, undone: false }} />);
    expect(out).toContain('Pause new asks until Dec 1?');
    const form = out.match(/<form class="pause-form"[^>]*>/)?.[0] ?? '';
    expect(form).toContain('method="post"');
    expect(form).toContain('action="/api/pause"');
    expect(out).toContain('<input type="hidden" name="token" value="AAAAAAAAAAAAAAAAAAAAAA"/>');
    expect(out).toContain('<input type="hidden" name="until" value="month"/>');
    expect(out).toContain('href="?until=2w"');
    expect(out).toMatch(/aria-checked="true"[^>]*data-value="month"/);
  });

  it('paused: Undo is its own POST with until=undo, and Your gate › is the primary', () => {
    const out = html(<PauseView token="AAAAAAAAAAAAAAAAAAAAAA" sample={false} nowMs={NOV9} initial={{ kind: 'paused', phrase: 'until Dec 1', canUndo: true, focus: false, error: null }} />);
    expect(out).toContain('Paused until Dec 1.');
    expect(out).toContain('<input type="hidden" name="until" value="undo"/>');
    expect(out).toContain('Your gate ›');
    const noUndo = html(<PauseView token="AAAAAAAAAAAAAAAAAAAAAA" sample={false} nowMs={NOV9} initial={{ kind: 'paused', phrase: 'until Dec 1', canUndo: false, focus: false, error: null }} />);
    expect(noUndo).not.toContain('Undo');
  });

  it('renders each error where it happened, in its own words', () => {
    const failed = html(<PauseView token="AAAAAAAAAAAAAAAAAAAAAA" sample={false} nowMs={NOV9} initial={{ kind: 'confirm', choice: 'month', error: 'failed', undone: false }} />);
    expect(failed).toContain(PAUSE_COPY.failed);
    const down = html(<PauseView token="AAAAAAAAAAAAAAAAAAAAAA" sample={false} nowMs={NOV9} initial={{ kind: 'confirm', choice: 'month', error: 'down', undone: false }} />);
    expect(down).toContain('Something broke on our side. Nothing changed.');
    const gone = html(<PauseView token="AAAAAAAAAAAAAAAAAAAAAA" sample={false} nowMs={NOV9} initial={{ kind: 'paused', phrase: 'until Dec 1', canUndo: false, focus: false, error: 'undo_gone' }} />);
    expect(gone).toContain('Paused until Dec 1.');
    expect(gone).toContain(PAUSE_COPY.undoGone);
  });

  it('maps BE2’s redirects onto the member’s real state', () => {
    const on = { status: 'on' as const, paused_until: null, can_undo: false };
    const pausedDec1 = { status: 'paused' as const, paused_until: '2026-12-01T08:00:00.000Z', can_undo: true };
    // GET with no query: the question, “until Dec 1” preselected; ?until=2w preselects from a no-JS chip.
    expect(pauseViewState(on, {})).toEqual({ kind: 'confirm', choice: 'month', error: null, undone: false });
    expect(pauseViewState(on, { until: '2w' })).toMatchObject({ kind: 'confirm', choice: '2w' });
    expect(pauseViewState(on, { until: 'forever' })).toMatchObject({ kind: 'confirm', choice: 'month' });
    // After the POST: the real end date, focus on the heading, Undo while this link may.
    expect(pauseViewState(pausedDec1, { done: 'month' })).toEqual({ kind: 'paused', phrase: 'until Dec 1', canUndo: true, focus: true, error: null });
    expect(pauseViewState({ ...pausedDec1, paused_until: '2026-11-23T18:15:00.000Z' }, { done: '2w' })).toMatchObject({ phrase: 'for 2 weeks' });
    expect(pauseViewState({ ...pausedDec1, paused_until: null }, { done: 'off' })).toMatchObject({ phrase: 'until you turn them back on' });
    // Visiting the link again while paused: no focus jump.
    expect(pauseViewState(pausedDec1, {})).toMatchObject({ kind: 'paused', focus: false });
    // Undo went through: the question again with “Undone.”; an Undo that restored an earlier pause shows that pause.
    expect(pauseViewState(on, { done: 'undo' })).toEqual({ kind: 'confirm', choice: 'month', error: null, undone: true });
    expect(pauseViewState({ ...pausedDec1, can_undo: false }, { done: 'undo' })).toMatchObject({ kind: 'paused', canUndo: false, focus: false });
    // Errors: our side, an Undo that can't apply any more, a bad value. Never “this link doesn’t work” for a link that does.
    expect(pauseViewState(on, { error: 'db_down' })).toMatchObject({ kind: 'confirm', error: 'down' });
    expect(pauseViewState({ ...pausedDec1, can_undo: false }, { error: 'invalid' })).toMatchObject({ kind: 'paused', error: 'undo_gone' });
    expect(pauseViewState(on, { error: 'invalid' })).toMatchObject({ kind: 'confirm', error: null });
    expect(pauseViewState(on, { error: 'bad_input' })).toMatchObject({ kind: 'confirm', error: 'failed' });
    expect(pauseErrorText('undo_gone')).toBe(PAUSE_COPY.undoGone);
  });
});
