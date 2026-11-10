// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedRunFor } from '@/components/playground/engine';
import { liveBlockCopy, LIST_IDLE, LIST_STALE } from '@/components/playground/copy';
import { ASK_IDS, computeDisplays, countDisplays, summaryLine } from '@/components/playground/model';
import { Playground } from '@/components/playground/playground';
import { presetById } from '@/lib/sample/presets';
import type { SampleAskKey } from '@/lib/types';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

const ENGINEER = presetById('engineer').rules;
const EDITED = `${ENGINEER}\nNo asks about crypto.`;

function sseText(events: { event: string; data: unknown }[]): string {
  return events.map((e, i) => `id: ${i + 1}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

function gateData(id: SampleAskKey, i: number) {
  const g = recordedRunFor('engineer', ENGINEER, 0).gates[id];
  return { ...g, i: ASK_IDS.indexOf(id), ms: 1000 + i * 50, confidence: 0.8, source: 'live' };
}

function liveEvents(ids: readonly SampleAskKey[] = ASK_IDS) {
  return [
    { event: 'plan', data: { run_id: 'r_dom1', mode: 'live', rules_chars: EDITED.length, gates: ids.map((id) => ({ i: ASK_IDS.indexOf(id), ask_id: id })) } },
    ...ids.map((id, i) => ({ event: 'gate', data: gateData(id, i) })),
    { event: 'done', data: { counts: { accept: 3, decline: 8, ask_back: 1, failed: 0 }, wall_ms: 2300, cost_usd: 0.0019 } },
  ];
}

const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8' };

type TryHandler = (body: { rules: string; ask_ids?: SampleAskKey[] }) => Response;

function mockFetch(live: string, onTry: TryHandler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/health') return Response.json({ live, live_paused_until: null, db: 'off', email: 'off', network: 'sample_only', checked_at: '' });
    if (url === '/api/try') return onTry(JSON.parse(String(init?.body ?? '{}')));
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderPage() {
  return render(<Playground qa={false} liveConfigured />);
}

const row = (id: string) => document.getElementById(`pg-row-${id}`) as HTMLElement;
/** The plain outcome label on a row (null before a run). */
const outcome = (id: string) => row(id).querySelector('.pg-out__label')?.textContent ?? null;
const stat = () => document.getElementById('pg-stat')?.textContent;
const runBtn = () => document.getElementById('pg-run') as HTMLElement;
const click = () => fireEvent.click(runBtn());
const edit = (value: string) => fireEvent.change(document.getElementById('pg-rules') as HTMLTextAreaElement, { target: { value } });

/** What the Engineer example run shows, read from the fixture (never hard-coded sample text). */
const EXAMPLE = computeDisplays(recordedRunFor('engineer', ENGINEER, 0), [], presetById('engineer').cap, false).map;
const idOf = (display: string) => ASK_IDS.find((id) => EXAMPLE[id].display === display) as SampleAskKey;
const SUMMARY = summaryLine(countDisplays(EXAMPLE));

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/rules');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('static HTML (what the CDN serves)', () => {
  it('says what you do here, in two steps, with one primary button and 12 unchecked asks', () => {
    const html = renderToString(<Playground qa={false} liveConfigured={false} />);
    expect(html).toContain('<h1 class="h1">What would you agree to help with?</h1>');
    expect(html).toContain('You’re the one being asked. Write what you’d agree to help with; see which asks would reach you.');
    expect(html).toContain('1. Your rules');
    expect(html).toContain('2. 12 asks from other founders');
    expect(html.match(/class="row pg-row"/g)).toHaveLength(12);
    expect(html.match(/data-primary=""/g)).toHaveLength(1);
    expect(html.match(/btn--primary/g)).toHaveLength(1);
    expect(html).toContain('See what reaches you');
    expect(html).not.toContain('pg-out');
    // Demo only: nothing links to sign-in, the member page, the board or the agents page.
    expect(html).not.toMatch(/href="\/(join|me|board|agents)/);
    expect(html).toContain('href="/"');
    for (const gone of ['Try a change', 'Raw trace', 'Disagree', 'Trap', 'Keep these rules', 'REAL']) expect(html).not.toContain(gone);
  });
});

describe('the page in a browser', () => {
  it('the button shows the example answers at once: three plain outcomes, one summary, the source line', async () => {
    const fetchMock = mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    expect(stat()).toBe(LIST_IDLE);
    click();
    expect(stat()).toBe(SUMMARY);
    expect(outcome(idOf('reach'))).toBe('Reaches you');
    expect(outcome(idOf('held'))).toBe('Matches, but you’re at your limit this month');
    expect(outcome(idOf('ask'))).toBe('They’d be asked a question first');
    expect(outcome(idOf('decline'))).toBe('Not for you');
    // The matched rule line is quoted in the member's own words.
    const g = EXAMPLE[idOf('reach')].gate;
    const quote = ENGINEER.slice(g?.cited[0]?.start, g?.cited[0]?.end);
    expect(row(idOf('reach')).querySelector('.pg-out .clause')?.textContent).toBe(`“${quote}”`);
    expect(row(idOf('ask')).querySelector('.pg-out__why')?.textContent).toBe(`“${EXAMPLE[idOf('ask')].gate?.question?.text}”`);
    expect(document.getElementById('pg-meta')?.textContent).toBe('Example verdicts, written by hand · not a model run');
    // The chain lives inside Details.
    const details = row(idOf('reach')).querySelector('details') as HTMLDetailsElement;
    expect(details.querySelector('summary')?.textContent).toBe('Details');
    expect(details.querySelector('.pg-chain')?.textContent).toMatch(/^example accept → code .* → cap 1 of 2$/);
    // Up to date: the button waits for a change.
    expect(runBtn().getAttribute('aria-disabled')).toBe('true');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/try')).toHaveLength(0);
  });

  it('editing the rules re-enables the button and clears answers that were for other rules', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    click();
    edit(EDITED);
    expect(runBtn().getAttribute('aria-disabled')).toBe('false');
    expect(stat()).toBe(LIST_STALE);
    expect(document.querySelector('.pg-out')).toBeNull();
    expect(document.getElementById('pg-meta')).toBeNull();
  });

  it('without a model key, edited rules get a short notice and never an answer', async () => {
    const fetchMock = mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/health')).toBe(true));
    await act(async () => undefined);
    edit(EDITED);
    click();
    expect(document.querySelector('[data-note="degraded"]')?.textContent).toBe(liveBlockCopy('off', { date: '', time: '' }));
    expect(outcome('a01')).toBeNull();
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/try')).toHaveLength(0);
  });

  it('a live run reads the SSE stream through postSse and renders the final state', async () => {
    const tries: unknown[] = [];
    mockFetch('ok', (body) => {
      tries.push(body);
      return new Response(sseText(liveEvents()), { status: 200, headers: SSE_HEADERS });
    });
    renderPage();
    edit(EDITED);
    click();
    expect(document.getElementById('pg-list')?.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(document.getElementById('pg-meta')?.textContent).toBe('Live check · 12 of 12 answered in 2.3 s · $0.002'));
    expect(tries).toEqual([{ rules: EDITED }]);
    expect(stat()).toBe(SUMMARY);
    expect(outcome(idOf('reach'))).toBe('Reaches you');
    const details = row(idOf('reach')).querySelector('details') as HTMLElement;
    expect(details.querySelector('.pg-chain')?.textContent).toMatch(/^model accept → code/);
    expect(details.textContent).toContain('Latency');
    expect(document.getElementById('pg-list')?.getAttribute('aria-busy')).toBe('false');
    // One summary in the polite live region at done, never one per row.
    await waitFor(() => expect(document.getElementById('live')?.textContent).toMatch(/^12 checked: \d+ reach you/));
  });

  it('rows say “Checking…” before any event arrives, and the button counts', async () => {
    let release: (() => void) | null = null;
    mockFetch('ok', () => {
      const text = sseText(liveEvents());
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          release = () => {
            c.enqueue(new TextEncoder().encode(text));
            c.close();
          };
        },
      });
      return new Response(stream, { status: 200, headers: SSE_HEADERS });
    });
    renderPage();
    edit(EDITED);
    click();
    expect(outcome('a01')).toBe('Checking…');
    expect(runBtn().textContent).toBe('Checking 0 of 12');
    expect(runBtn().getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => {
      (release as unknown as () => void)();
    });
    await waitFor(() => expect(stat()).toBe(SUMMARY));
  });

  it('a lost stream keeps the answered rows and “Retry the other 5” asks only for those ids', async () => {
    const bodies: { rules: string; ask_ids?: SampleAskKey[] }[] = [];
    mockFetch('ok', (body) => {
      bodies.push(body);
      if (bodies.length === 1) {
        const text = sseText(liveEvents().slice(0, 8)); // plan + 7 gates
        let pulls = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(c) {
            pulls++;
            if (pulls === 1) c.enqueue(new TextEncoder().encode(text));
            else c.error(new Error('connection reset'));
          },
        });
        return new Response(stream, { status: 200, headers: SSE_HEADERS });
      }
      return new Response(sseText(liveEvents(body.ask_ids)), { status: 200, headers: SSE_HEADERS });
    });
    renderPage();
    edit(EDITED);
    click();
    await waitFor(() => expect(document.querySelector('[data-note="lost"] p')?.textContent).toBe('Lost the connection after 7 of 12.'));
    expect(stat()).toMatch(/ · 5 not checked$/);
    const retry = document.querySelector('[data-note="lost"] button') as HTMLElement;
    expect(retry.textContent).toBe('Retry the other 5');
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(document.querySelector('[data-note="lost"]')).toBeNull());
    expect(bodies[1]).toEqual({ rules: EDITED, ask_ids: ASK_IDS.slice(7) });
    expect(stat()).toBe(SUMMARY);
  });

  it('the monthly limit is a 1–5 choice applied at once, with no model call', async () => {
    const fetchMock = mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    click();
    expect(document.getElementById('pg-cap-lbl')?.textContent).toBe('Up to 2 intros a month');
    expect(document.querySelectorAll('.pg-cap-row [role="radio"]')).toHaveLength(5);
    fireEvent.click(document.querySelector('.pg-cap-row [data-value="1"]') as HTMLElement);
    expect(document.getElementById('pg-cap-lbl')?.textContent).toBe('Up to 1 intro a month');
    const one = computeDisplays(recordedRunFor('engineer', ENGINEER, 0), [], 1, false).map;
    expect(stat()).toBe(summaryLine(countDisplays(one)));
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/try')).toHaveLength(0);
  });

  it('the three examples are plain buttons: picking one replaces the rules', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    const buttons = [...document.querySelectorAll<HTMLElement>('#pg-presets button')];
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    edit(EDITED);
    expect(document.querySelector('#pg-presets [aria-pressed="true"]')).toBeNull();
    const health = document.querySelector('#pg-presets [data-value="health"]') as HTMLElement;
    fireEvent.click(health);
    expect((document.getElementById('pg-rules') as HTMLTextAreaElement).value).toBe(presetById('health').rules);
    expect(health.getAttribute('aria-pressed')).toBe('true');
  });

  it('autosaves the rules to oti.playground and restores the tab’s run after a refresh', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    const first = renderPage();
    click();
    const saved = JSON.parse(sessionStorage.getItem('oti.playground') ?? 'null');
    expect(saved).toMatchObject({ v: 1, preset: 'engineer', rules: ENGINEER, cap: 2, mode: 'recorded' });
    expect(saved.results).toHaveLength(12);
    first.unmount();
    renderPage();
    await waitFor(() => expect(stat()).toBe(SUMMARY));
  });

  it('QA state from the URL loads the fixture, labelled; a row that wasn’t checked offers Retry', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    window.history.replaceState(null, '', '/rules?state=partial-timeout');
    render(<Playground qa liveConfigured />);
    await waitFor(() => expect(stat()).toMatch(/ · 1 not checked$/));
    expect(document.getElementById('pg-meta')?.textContent).toBe('QA fixture, not a model call');
    expect(outcome('a09')).toBe('Not checked');
    expect(row('a09').querySelector('.pg-retry')).not.toBeNull();
  });

  it('QA is ignored when it is off', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    window.history.replaceState(null, '', '/rules?state=all-declined');
    renderPage();
    await new Promise((r) => setTimeout(r, 20));
    expect(outcome('a01')).toBeNull();
    expect(stat()).toBe(LIST_IDLE);
  });
});
