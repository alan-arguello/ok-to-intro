// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedRunFor } from '@/components/playground/engine';
import { ASK_IDS } from '@/components/playground/model';
import { Playground } from '@/components/playground/playground';
import { REAL_LINE_OFF } from '@/lib/oti/copy';
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
  return render(<Playground realLine={REAL_LINE_OFF} qaRealLine={null} qa={false} liveConfigured />);
}

const row = (id: string) => document.getElementById(`pg-row-${id}`) as HTMLElement;
const pill = (id: string) => (document.getElementById(`pg-v-${id}`) as HTMLElement).textContent;

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('static HTML (what the CDN serves)', () => {
  it('has the question, the REAL line, the one primary Run and 12 Not run rows', () => {
    const html = renderToString(<Playground realLine={REAL_LINE_OFF} qaRealLine={null} qa={false} liveConfigured={false} />);
    expect(html).toContain('<h1 class="h1">What would you agree to be asked?</h1>');
    expect(html).toContain('The real network isn’t connected on this instance yet.');
    expect(html.match(/class="row is-interactive pg-row is-notrun/g)).toHaveLength(12);
    expect(html.match(/data-primary=""/g)).toHaveLength(2); // the desktop pill and the phone bar (one visible per width)
    expect(html).toContain('Run 12 sample asks');
    expect(html).toContain('12 sample asks, as they would arrive in one month · 4 are traps');
    expect(html).not.toContain('Prototype: example numbers');
    // Without a model key the static HTML already says so (no flip after the health check).
    expect(html).toContain('Shows the example verdicts at once. Live checks are off on this instance.');
    const keyed = renderToString(<Playground realLine={REAL_LINE_OFF} qaRealLine={null} qa={false} liveConfigured />);
    expect(keyed).toContain('Shows the example verdicts at once. Run live calls the model, about 2 s.');
  });
});

describe('the page in a browser', () => {
  it('Run shows the example verdicts at once, with the read view, chain and Details', async () => {
    const fetchMock = mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    await waitFor(() => expect(document.getElementById('pg-run-note')?.textContent).toBe('Shows the example verdicts at once. Live checks are off on this instance.'));
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    expect(pill('a01')).toBe('Reaches you');
    expect(pill('a09')).toBe('Over your cap');
    expect(document.getElementById('pg-meta-text')?.textContent).toBe('Example verdicts, written by hand · not a model run ·');
    expect(document.getElementById('pg-live')?.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelectorAll('#pg-rules-list mark').length).toBeGreaterThan(0);
    expect(row('a01').querySelector('.pg-chain')?.textContent).toBe('example accept → code 2 of 2 quotes found → cap 1 of 2');
    // Details: one row open at a time, labelled by company, verdict and “Details”.
    const t1 = row('a01').querySelector('.row__toggle') as HTMLElement;
    expect(t1.getAttribute('aria-labelledby')).toBe('pg-n-a01 pg-v-a01 pg-x-a01');
    expect(t1.getAttribute('aria-describedby')).toBe('pg-b-a01');
    fireEvent.click(t1);
    expect(t1.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('pg-det-a01')?.textContent).toContain('Decided by');
    fireEvent.click(row('a03').querySelector('.row__toggle') as HTMLElement);
    expect(t1.getAttribute('aria-expanded')).toBe('false');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/try')).toHaveLength(0);
  });

  it('Run live without a key shows the off notice and never renders a verdict it didn’t get', async () => {
    const fetchMock = mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    await waitFor(() => expect(document.getElementById('pg-run-note')?.textContent).toContain('off on this instance'));
    fireEvent.change(document.getElementById('pg-rules') as HTMLTextAreaElement, { target: { value: EDITED } });
    expect(document.getElementById('pg-edited')?.hidden).toBe(false);
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    expect(document.querySelector('[data-note="degraded"]')?.textContent).toBe('Live checks are off on this instance: no model API key is set. Your rules stay in this tab.');
    expect(pill('a01')).toBe('Not run');
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/try')).toHaveLength(0);
  });

  it('a live run reads the SSE stream through postSse and renders the final state', async () => {
    const tries: unknown[] = [];
    mockFetch('ok', (body) => {
      tries.push(body);
      return new Response(sseText(liveEvents()), { status: 200, headers: SSE_HEADERS });
    });
    renderPage();
    await waitFor(() => expect(document.getElementById('pg-run-note')?.textContent).toBe('Shows the example verdicts at once. Run live calls the model, about 2 s.'));
    fireEvent.change(document.getElementById('pg-rules') as HTMLTextAreaElement, { target: { value: EDITED } });
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    expect(document.getElementById('pg-list')?.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(document.getElementById('pg-meta-text')?.textContent).toBe('Live · 12 gates in 2.3 s · $0.002 · every quote found in your rules'));
    expect(tries).toEqual([{ rules: EDITED }]);
    expect(pill('a01')).toBe('Reaches you');
    expect(row('a01').querySelector('.row__aside')?.textContent).toBe('1.0 s');
    expect(row('a01').querySelector('.pg-chain')?.textContent).toBe('model accept → code 2 of 2 quotes found → cap 1 of 2');
    expect(document.getElementById('pg-list')?.getAttribute('aria-busy')).toBe('false');
    // One summary in the polite live region at done, never one per row.
    await waitFor(() => expect(document.getElementById('live')?.textContent).toBe('12 checked: 2 reach you, 1 over your cap, 1 question first, 8 declined.'));
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
    await waitFor(() => expect(document.getElementById('pg-run-note')?.textContent).toContain('Run live calls the model'));
    fireEvent.change(document.getElementById('pg-rules') as HTMLTextAreaElement, { target: { value: EDITED } });
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-note="lost"] p')?.textContent).toBe('Lost the connection after 7 of 12.'));
    expect(document.getElementById('pg-stat')?.textContent).toBe('7 of 12 checked · 5 not checked');
    const retry = document.querySelector('[data-note="lost"] button') as HTMLElement;
    expect(retry.textContent).toBe('Retry the other 5');
    await act(async () => {
      fireEvent.click(retry);
    });
    await waitFor(() => expect(document.querySelector('[data-note="lost"]')).toBeNull());
    expect(bodies[1]).toEqual({ rules: EDITED, ask_ids: ['a08', 'a09', 'a10', 'a11', 'a12'] });
    expect(screen.getByText(/reach you/, { selector: '#pg-stat' })).toBeTruthy();
  });

  it('Cap 2 → 1, Disagree, Raw trace and the stale state', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    fireEvent.click(document.querySelector('#pg-try [data-act="cap"]') as HTMLElement);
    expect(document.getElementById('pg-meta-text')?.textContent).toBe('Cap changed to 1. Applied in code, no model call.');
    expect(pill('a03')).toBe('Over your cap');
    expect(row('a03').querySelector('.pg-changed')?.textContent).toBe('Changed · was Reaches you');
    expect(document.querySelector('#pg-try .pg-applied')?.textContent).toBe('Applied: Cap 2 → 1 · Undo');
    const dis = row('a08').querySelector('.pg-disagree') as HTMLElement;
    fireEvent.click(dis);
    expect(dis.getAttribute('aria-pressed')).toBe('true');
    expect(document.getElementById('pg-agree')?.textContent).toBe('You’d decide 1 of 12 differently. Your marks stay in this tab.');
    fireEvent.click(document.getElementById('pg-trace-btn') as HTMLElement);
    expect(document.getElementById('pg-trace')?.hidden).toBe(false);
    expect(row('a01').hidden).toBe(true);
    expect(document.getElementById('pg-trace')?.textContent).toContain('cap   #1 reach · 1 of 1 (code)');
    fireEvent.click(document.getElementById('pg-trace-btn') as HTMLElement);
    fireEvent.click(document.getElementById('pg-edit') as HTMLElement);
    fireEvent.change(document.getElementById('pg-rules') as HTMLTextAreaElement, { target: { value: EDITED } });
    expect(document.getElementById('pg-stale')?.textContent).toContain('Rules changed. Run again to update the 12 verdicts.');
    expect(row('a01').classList.contains('is-stale')).toBe(true);
    expect(row('a01').textContent).toContain('Out of date');
    expect(document.getElementById('pg-run')?.classList.contains('btn--primary')).toBe(true);
    expect(document.getElementById('pg-cta-keep')?.classList.contains('btn--primary')).toBe(false);
    expect(document.getElementById('pg-bar-text')?.textContent).toBe('Rules changed');
  });

  it('autosaves the rules to oti.playground for /join and the other surfaces', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    const saved = JSON.parse(sessionStorage.getItem('oti.playground') ?? 'null');
    expect(saved).toMatchObject({ v: 1, preset: 'engineer', rules: ENGINEER, cap: 2, mode: 'recorded' });
    expect(saved.results.find((r: { ask_id: string }) => r.ask_id === 'a01').cited[0]).toBe('founders about Postgres, queues or LLM evals in production');
  });

  it('restores the tab’s run after a refresh', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    const first = renderPage();
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    first.unmount();
    renderPage();
    await waitFor(() => expect(pill('a01')).toBe('Reaches you'));
    expect(document.getElementById('pg-rules-list')).not.toBeNull();
  });

  it('QA state from the URL loads the fixture and shows the example REAL line with its note', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    window.history.replaceState(null, '', '/?state=partial-timeout');
    render(<Playground realLine={REAL_LINE_OFF} qaRealLine="Network since Nov 9: 23 members, 12 asks, 7 intros." qa liveConfigured />);
    await waitFor(() => expect(document.getElementById('pg-stat')?.textContent).toBe('11 of 12 checked · 1 not checked'));
    expect(document.getElementById('pg-real-text')?.textContent).toBe('Network since Nov 9: 23 members, 12 asks, 7 intros.');
    expect(document.querySelector('.pg-proto .proto-note')?.textContent).toMatch(/^Prototype: example numbers/);
    expect(document.getElementById('pg-meta-text')?.textContent).toBe('QA fixture, not a model call · 11 of 12 asks · every quote found in your rules');
    expect(pill('a09')).toBe('Not checked');
    expect(row('a09').querySelector('.pg-retry')).not.toBeNull();
  });

  it('Run live keeps the read view while it streams (tallies read “checking…”), and rows show CHECKING before any event', async () => {
    let release: (() => void) | null = null;
    mockFetch('ok', () => {
      const text = sseText(liveEvents().map((e) => (e.event === 'plan' ? { ...e, data: { ...(e.data as object), rules_chars: ENGINEER.length } } : e)));
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
    await waitFor(() => expect(document.getElementById('pg-run-note')?.textContent).toContain('Run live calls the model'));
    fireEvent.click(document.getElementById('pg-run') as HTMLElement);
    fireEvent.click(document.getElementById('pg-live') as HTMLElement);
    expect(pill('a01')).toBe('Checking');
    expect(document.getElementById('pg-run')?.textContent).toBe('Checking 0 of 12');
    expect(document.getElementById('pg-run')?.getAttribute('aria-busy')).toBe('true');
    expect([...document.querySelectorAll('#pg-rules-list .tally')].map((t) => t.textContent)).toEqual(['checking…', 'checking…', 'checking…', 'checking…']);
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => {
      (release as unknown as () => void)();
    });
    await waitFor(() => expect(document.getElementById('pg-meta-text')?.textContent).toBe('Live · 12 gates in 2.3 s · $0.002 · every quote found in your rules'));
    expect(document.getElementById('pg-diff')?.textContent).toBe('Every verdict matches the hand-written examples.');
    expect(document.querySelectorAll('#pg-rules-list .tally')[0]?.textContent).toBe('3 let in · 1 question');
  });

  it('switching presets after an edit asks first; Replace focuses the chosen preset', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    renderPage();
    fireEvent.change(document.getElementById('pg-rules') as HTMLTextAreaElement, { target: { value: EDITED } });
    const health = document.querySelector('#pg-presets [data-value="health"]') as HTMLElement;
    expect(document.querySelector('#pg-presets [aria-checked="true"]')).toBeNull();
    fireEvent.click(health);
    expect(document.getElementById('pg-confirm-text')?.textContent).toBe('Replace your rules with Health operator?');
    fireEvent.click(document.getElementById('pg-replace') as HTMLElement);
    expect((document.getElementById('pg-rules') as HTMLTextAreaElement).value).toBe(presetById('health').rules);
    await waitFor(() => expect(document.activeElement).toBe(health));
    expect(health.getAttribute('aria-checked')).toBe('true');
  });

  it('QA is ignored when it is off', async () => {
    mockFetch('off', () => new Response('{}', { status: 503 }));
    window.history.replaceState(null, '', '/?state=all-declined');
    renderPage();
    await new Promise((r) => setTimeout(r, 20));
    expect(pill('a01')).toBe('Not run');
    expect(document.getElementById('pg-real-text')?.textContent).toBe(REAL_LINE_OFF);
  });
});
