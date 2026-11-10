// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exampleCompiled, exampleRealView, exampleRun, holderCell, type SampleRun } from '@/components/ask/fanout-model';
import { foldEvent } from '@/components/ask/sample-runner';
import { getRun, putRun, resetSampleStoreForTests, sharedStateOf, sharedStoreOf } from '@/components/ask/sample-store';
import { RealStatus } from '@/components/ask/status-real';
import { SampleStatus } from '@/components/ask/status-sample';
import { QA_STATES } from '@/lib/qa';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';
import type { FanoutEvent } from '@/lib/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/ask/sa_eng' }));

const LIVE_OFF = { state: 'off' as const, until: null };
const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

/** A finished SAMPLE run as BE2 would stream it (built from the canonical example, re-streamed through foldEvent). */
function streamedRun(id: 'sa_eng' | 'sa_health' = 'sa_eng'): SampleRun {
  const ex = exampleRun(id, 'offered', null, Date.now());
  const sa = SAMPLE_NETWORK_ASKS[id === 'sa_eng' ? 'engineer' : 'health'];
  const events: FanoutEvent[] = [
    { event: 'plan', data: { ask_id: id, network: 'sample', total: 40, sample_source: 'authored', recorded_at: '2026-11-09T09:00:00-08:00' } },
    ...ex.cells.map((c) => ({ event: 'cell' as const, data: { ...c!, at: undefined } })),
    ...ex.questions.map((q) => ({ event: 'question' as const, data: { qid: q.qid, type: q.type, text: q.text, gates: q.gates } })),
    { event: 'offer', data: { expires_at: new Date(Date.now() + 72 * 3_600_000).toISOString(), to: 'member', cell: holderCell(ex)!.cell } },
    { event: 'done', data: { wall_ms: 3, people_interrupted: 1, counts: { offered: 1, next: 1, question: 1, nothistime: 37 }, gates_ran: 33, gates_failed: 0, failed_closed: false } },
  ];
  let run: SampleRun = { ...ex, example: false, outcome: 'streaming', plan: null, cells: new Array(40).fill(null), questions: [], offer: null, done: null, offered: [], offered_at: null, compiled: exampleCompiled(sa), sent_at: Date.now() };
  events.forEach((e, i) => {
    run = foldEvent(run, e, i);
  });
  return run;
}

beforeEach(() => {
  sessionStorage.clear();
  resetSampleStoreForTests();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"not_configured","message":"x"}', { status: 503, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/ask/sa_… (SAMPLE, lives in this tab)', () => {
  it('the server sends a shell, never someone’s state', () => {
    const html = renderToString(<SampleStatus id="sa_eng" qaState={null} live={LIVE_OFF} />);
    expect(html).toContain('Churn after month 3, 20 min?');
    expect(html).not.toContain('Offered');
  });

  it('a finished run: offered, four-state legend, the loop link, and the shared store for /o/sample', async () => {
    putRun(streamedRun());
    render(<SampleStatus id="sa_eng" qaState={null} live={LIVE_OFF} />);
    await flush();
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/^Offered · waitingWaiting on 1 person whose rules accept asks like this\./);
    expect(document.getElementById('st-legend')!.textContent).toBe('1 offered1 next in line1 question for you37 not this time');
    expect(document.getElementById('st-interrupted')!.textContent).toBe('1');
    expect(document.getElementById('st-open')!.getAttribute('href')).toBe('/o/sample?ask=sa_eng');
    expect(document.getElementById('st-replay')!.textContent).toBe('Example results for 40 sample members, written by hand · not a model run');
    // Hand-written results took no time: no duration in the meta line.
    expect(document.getElementById('st-meta')!.textContent).toMatch(/^Sent .* · SAMPLE network · 40 members$/);
    const shared = JSON.parse(sessionStorage.getItem('oti.sampleAsk')!);
    expect(shared).toMatchObject({ v: 1, id: 'sa_eng', state: 'offered', offered_to: holderCell(getRun('sa_eng')!)!.label });
  });

  it('a fan-out that finishes on the page is announced once, not per cell', async () => {
    const done = streamedRun();
    putRun({ ...done, outcome: 'streaming', cells: done.cells.map((c, i) => (i < 10 ? c : null)), offer: null, offered: [], offered_at: null, done: null });
    // A run found mid-stream on mount is sent again (nothing to resume); this fetch never answers, so the page
    // stays on the stream until the run settles below.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<SampleStatus id="sa_eng" qaState={null} live={LIVE_OFF} />);
    await flush();
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/^CheckingChecking members’ gates… 0 of 40 answered\.$/);
    expect(document.getElementById('live')?.textContent ?? '').toBe('');
    await act(async () => {
      putRun({ ...getRun('sa_eng')!, ...done, outcome: 'offered' });
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/^Offered · waiting/);
    expect(document.getElementById('live')!.textContent).toBe('Offered to 1 person. 1 person interrupted.');
  });

  it('the sample loop: a No moves it on, an OK makes the intro', async () => {
    putRun(streamedRun());
    render(<SampleStatus id="sa_eng" qaState={null} live={LIVE_OFF} />);
    await flush();
    sessionStorage.setItem('oti.sampleOffer', JSON.stringify({ v: 1, ask_id: 'sa_eng', action: 'no', at: Date.now() + 5, text: null }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/Offered to the next person in line \(2 of 2\)\./);
    expect(document.getElementById('st-interrupted')!.textContent).toBe('2');
    sessionStorage.setItem('oti.sampleOffer', JSON.stringify({ v: 1, ask_id: 'sa_eng', action: 'ok', at: Date.now() + 10, text: null }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise((r) => setTimeout(r, 0));
    });
    const outcome = document.getElementById('st-outcome')!.textContent!;
    expect(outcome).toMatch(/said OK\. The intro email went to you both \(sample, no email was sent\)\./);
    const links = [...document.querySelectorAll('.st-links a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/emails/intro?ask=sa_eng', '/c/sample?ask=sa_eng&role=asker']);
    expect(JSON.parse(sessionStorage.getItem('oti.sampleAsk')!).state).toBe('intro');
  });

  it('“Show what askers never see” reveals labels, caps and reasons, and the member’s card', async () => {
    putRun(streamedRun());
    render(<SampleStatus id="sa_eng" qaState={null} live={LIVE_OFF} />);
    await flush();
    expect(screen.getByText('What you sent')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Show what askers never see (sample only)' }));
    expect(document.getElementById('st-legend')!.textContent).toMatch(/declined \(topic \d+ · stage 1 · proof 1 · region 1\)7 not available \(5 at their monthly cap · 2 paused\)/);
    expect(screen.getByText('What the member sees')).toBeTruthy();
    expect(screen.getByText('Askers never see this card. It is shown here because this is a sample.')).toBeTruthy();
    expect(screen.getByText('On the real network, askers see only: offered, next in line, question for you, not this time.')).toBeTruthy();
    const holder = holderCell(getRun('sa_eng')!)!;
    const cell = document.querySelectorAll('#st-waffle > button')[holder.cell] as HTMLButtonElement;
    expect(cell.getAttribute('aria-label')).toMatch(/accepted · offered · cited “.+” · cap 2 of 2 used/);
    fireEvent.click(cell);
    expect(document.getElementById('st-pop')!.textContent).toBe(cell.getAttribute('aria-label'));
  });

  it('withdraw needs an inline confirm', async () => {
    putRun(streamedRun());
    render(<SampleStatus id="sa_eng" qaState={null} live={LIVE_OFF} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(screen.getByText('Withdraw this ask? The person who has it will be told it’s no longer needed.')).toBeTruthy();
    fireEvent.click(document.getElementById('st-withdraw-yes')!);
    await flush();
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/^WithdrawnYou withdrew this ask on .*\(sample, no email was sent\)\.$/);
    expect(document.getElementById('st-legend')!.textContent).toBe('40 not this time');
    expect(getRun('sa_eng')!.outcome).toBe('withdrawn');
  });

  it('a send BE2 refused says nothing was sent, with its own message', async () => {
    const run = streamedRun();
    putRun({ ...run, outcome: 'refused', refusal: { status: 503, error: 'live_unavailable', message: 'Your own text needs live checks, and they’re off on this instance. Nothing was sent to anyone.' } });
    render(<SampleStatus id="sa_eng" qaState={null} live={LIVE_OFF} />);
    await flush();
    expect(document.getElementById('st-outcome')!.textContent).toContain('Nothing was sent to anyone. Your own text needs live checks, and they’re off on this instance.');
  });

  it('a sample ask this tab never sent offers to send it, and stores nothing until you do', async () => {
    render(<SampleStatus id="sa_health" qaState={null} live={LIVE_OFF} />);
    await flush();
    expect(screen.getByText(/This sample ask hasn’t been sent from this tab\./)).toBeTruthy();
    expect(getRun('sa_health')).toBeNull();
    cleanup();
    render(<SampleStatus id="sa_x7Kp2q" qaState={null} live={LIVE_OFF} />);
    await flush();
    expect(screen.getByText(/This sample ask isn’t in this tab\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Write an ask' }).getAttribute('href')).toBe('/ask');
  });

  it.each(QA_STATES.askStatus.filter((s) => s !== 'real'))('QA state %s renders without storing anything', async (state) => {
    render(<SampleStatus id={['ask-back', 'answered', 'intro'].includes(state) ? 'sa_health' : 'sa_eng'} qaState={state} live={LIVE_OFF} />);
    await flush();
    expect(document.getElementById('st-outcome')).toBeTruthy();
    expect(sessionStorage.getItem('oti.s2.runs')).toBeNull();
    expect(sessionStorage.getItem('oti.sampleAsk')).toBeNull();
  });
});

describe('/ask/a_… (REAL, the serializer’s view)', () => {
  it('the QA example: four states, no reveal switch, crumbs to your asks, a dashed example note', () => {
    render(<RealStatus initial={exampleRealView()} from="Maya Bennett · Oakline Health · Seed · Chicago" example />);
    expect(screen.getByRole('link', { name: '‹ Your asks' }).getAttribute('href')).toBe('/me#asks');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('Example REAL ask for layout (QA state). A real ask reads from the database.')).toBeTruthy();
    expect(document.getElementById('st-legend')!.textContent).toBe('1 offered2 next in line37 not this time');
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/They have until \w+ Nov 1[23], \d\d:04 \w+ to reply\./);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a later position reads “Offered to the next person in line”, never passed or expired', () => {
    const v = exampleRealView();
    render(<RealStatus initial={{ ...v, offered: { reply_by: '2026-11-13T09:00:00-08:00', position: 2, in_line: 3 } }} from="x" example />);
    const text = document.getElementById('st-outcome')!.textContent!;
    expect(text).toMatch(/Offered to the next person in line \(2 of 3\)\./);
    expect(text).not.toMatch(/passed|expired/);
  });

  it('no match shows the coarse reasons and what would change it', () => {
    const v = exampleRealView();
    render(
      <RealStatus
        initial={{ ...v, outcome: 'no_match', offered: null, people_interrupted: 0, cells: v.cells.map(() => 'nothistime'), no_match: { why: { topic: 30, other: 10 }, suggestion: { context: '14 buyer calls; 2 deals have sat in procurement for 5 months.', add: 'We charge $18k a year per customer.', why: '4 gates wanted a price. If you have one, add it.' } } }}
        from="x"
        example
      />,
    );
    expect(screen.getByText('Why: topic 30 · other 10.')).toBeTruthy();
    expect(screen.getByText('What would change it')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Use this edit' }).getAttribute('href')).toBe('/ask?resend=a_91x&edit=1');
  });
});

describe('the shared store R reads', () => {
  it('maps every outcome to a state name /o/sample understands', () => {
    const allowed = new Set<string>(QA_STATES.askStatus);
    for (const o of ['ready', 'streaming', 'offered', 'offered-you', 'question', 'no-match', 'failed-closed', 'answered', 'intro', 'moved-on', 'closed-all-passed', 'expired-deadline', 'closed', 'withdrawn', 'refused', 'lost', 'offline'] as const) {
      expect(allowed.has(sharedStateOf(o))).toBe(true);
    }
    const s = sharedStoreOf(streamedRun());
    expect(s).toMatchObject({ v: 1, id: 'sa_eng', preset: 'engineer', state: 'offered', you_cited: [] });
    expect(s.question).toEqual({ type: 'role', text: 'Who on your team would join the call, and what is their role?' });
  });
});

describe('/ask/a_… sends a created REAL ask once and follows it', () => {
  function sse(events: { event: string; data: unknown }[]): Response {
    const body = events.map((e, i) => `id: ${i + 1}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  }

  it('ready → POST send → the four-state stream → done → the serialized view', async () => {
    const v = exampleRealView();
    const ready = { ...v, id: 'a_test1', outcome: 'ready' as const, sent_at: null, cells: [], people_interrupted: 0, offered: null, trace: [] };
    const settled = { ...v, id: 'a_test1' };
    const cells = v.cells.map((state, cell) => ({ event: 'cell', data: { cell, state } }));
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url === '/api/asks/a_test1/send')
          return sse([
            { event: 'plan', data: { ask_id: 'a_test1', network: 'real', total: 40 } },
            ...cells,
            { event: 'offer', data: { expires_at: v.offered!.reply_by } },
            { event: 'done', data: { wall_ms: 2104, people_interrupted: 1, counts: { offered: 1, next: 2, question: 0, nothistime: 37 }, gates_ran: null, gates_failed: 0, failed_closed: false } },
          ]);
        if (url === '/api/asks/a_test1') return new Response(JSON.stringify(settled), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response('{}', { status: 404 });
      }),
    );
    render(<RealStatus initial={ready} from="Maya Bennett · Oakline Health · Seed · Chicago" />);
    await flush();
    await flush();
    await flush();
    expect(calls).toEqual(['POST /api/asks/a_test1/send', 'GET /api/asks/a_test1']);
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/Offered · waiting/);
    expect(document.getElementById('st-legend')!.textContent).toBe('1 offered2 next in line37 not this time');
    expect(document.getElementById('st-meta')!.textContent).toMatch(/REAL network · 40 members · 2\.1 s$/);
    cleanup();
    // A second mount (a reload, another tab) never sends twice: the page reads the ask instead.
    calls.length = 0;
    render(<RealStatus initial={ready} from="x" />);
    await flush();
    expect(calls).not.toContain('POST /api/asks/a_test1/send');
  });

  it('a send that is refused keeps the ask and says why', async () => {
    const v = exampleRealView();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'live_unavailable', message: 'Live checks are paused. Nothing was sent to anyone. Your ask is saved.' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    render(<RealStatus initial={{ ...v, id: 'a_test2', outcome: 'ready', sent_at: null, cells: [], offered: null, people_interrupted: 0 }} from="x" />);
    await flush();
    await flush();
    expect(document.getElementById('st-outcome')!.textContent).toBe('Nothing was sent to anyone. Live checks are paused. Your ask is saved.Try again');
  });

  it('Try again after a refused send sends again (and only once per press)', async () => {
    const v = exampleRealView();
    const calls: string[] = [];
    let refuse = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url === '/api/asks/a_test4/send') {
          if (refuse) return new Response(JSON.stringify({ error: 'rate_limited', message: 'You sent 20 asks in 10 minutes. Nothing was sent to anyone.' }), { status: 429, headers: { 'content-type': 'application/json' } });
          return sse([{ event: 'plan', data: { ask_id: 'a_test4', network: 'real', total: 40 } }, { event: 'done', data: { wall_ms: 900, people_interrupted: 1, counts: { offered: 1, next: 2, question: 0, nothistime: 37 }, gates_ran: null, gates_failed: 0, failed_closed: false } }]);
        }
        if (url === '/api/asks/a_test4') return new Response(JSON.stringify(refuse ? { ...v, id: 'a_test4', outcome: 'ready', sent_at: null, cells: [], offered: null, people_interrupted: 0 } : { ...v, id: 'a_test4' }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response('{}', { status: 404 });
      }),
    );
    render(<RealStatus initial={{ ...v, id: 'a_test4', outcome: 'ready', sent_at: null, cells: [], offered: null, people_interrupted: 0 }} from="x" />);
    await flush();
    await flush();
    expect(document.getElementById('st-outcome')!.textContent).toBe('Nothing was sent to anyone. You sent 20 asks in 10 minutes.Try again');
    refuse = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    for (let i = 0; i < 4; i++) await flush();
    expect(calls.filter((c) => c === 'POST /api/asks/a_test4/send')).toHaveLength(2);
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/Offered · waiting/);
  });

  it('when the view can’t be read after the send, the page says so instead of spinning', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const v = exampleRealView();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === '/api/asks/a_test5/send') return sse([{ event: 'plan', data: { ask_id: 'a_test5', network: 'real', total: 40 } }, { event: 'done', data: { wall_ms: 900, people_interrupted: 0, counts: { offered: 0, next: 0, question: 0, nothistime: 40 }, gates_ran: null, gates_failed: 0, failed_closed: false } }]);
          return new Response('{"error":"db_down"}', { status: 503, headers: { 'content-type': 'application/json' } });
        }),
      );
      render(<RealStatus initial={{ ...v, id: 'a_test5', outcome: 'ready', sent_at: null, cells: [], offered: null, people_interrupted: 0 }} from="x" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(document.getElementById('st-outcome')!.textContent).toBe('Couldn’t read where your ask stands. It is saved, and its fan-out finishes without this page.Try again');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a tail the server ends after its time limit is opened again while the fan-out runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const v = exampleRealView();
      const instances: { url: string; emit: (n: string, d: unknown) => void; readyState: number }[] = [];
      class FakeEventSource {
        static CLOSED = 2;
        readyState = 1;
        url: string;
        listeners = new Map<string, (e: MessageEvent<string>) => void>();
        onerror: (() => void) | null = null;
        constructor(url: string) {
          this.url = url;
          instances.push(this);
        }
        addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
          this.listeners.set(name, fn);
        }
        close() {
          this.readyState = 2;
        }
        emit(name: string, data: unknown) {
          this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
        }
      }
      vi.stubGlobal('EventSource', FakeEventSource);
      render(<RealStatus initial={{ ...v, id: 'a_test6', outcome: 'gating', cells: v.cells.map(() => 'nothistime'), offered: null, people_interrupted: 0 }} from="x" />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
      expect(instances).toHaveLength(1);
      await act(async () => {
        instances[0]!.emit('end', { reason: 'timeout' });
        await vi.advanceTimersByTimeAsync(2_100);
      });
      expect(instances).toHaveLength(2);
      expect(instances[0]!.readyState).toBe(2);
      expect(instances[1]!.url).toBe('/api/asks/a_test6');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gating → tails the ask with EventSource and closes on end', async () => {
    const v = exampleRealView();
    const instances: FakeEventSource[] = [];
    class FakeEventSource {
      static CLOSED = 2;
      readyState = 1;
      url: string;
      listeners = new Map<string, (e: MessageEvent<string>) => void>();
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        instances.push(this);
      }
      addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
        this.listeners.set(name, fn);
      }
      close() {
        this.readyState = 2;
      }
      emit(name: string, data: unknown) {
        this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    render(<RealStatus initial={{ ...v, id: 'a_test3', outcome: 'gating', cells: v.cells.map(() => 'nothistime'), offered: null, people_interrupted: 0 }} from="x" />);
    await flush();
    expect(instances.map((i) => i.url)).toEqual(['/api/asks/a_test3']);
    await act(async () => {
      instances[0]!.emit('view', { ...v, id: 'a_test3' });
    });
    expect(document.getElementById('st-outcome')!.textContent).toMatch(/Offered · waiting/);
    await act(async () => {
      instances[0]!.emit('end', { reason: 'settled' });
    });
    expect(instances[0]!.readyState).toBe(2);
  });
});
