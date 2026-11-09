// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskCompose, type AskComposeProps } from '@/components/ask/compose';
import { getRun, resetSampleStoreForTests } from '@/components/ask/sample-store';
import { SAMPLE_NETWORK_ASKS } from '@/lib/sample/network';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }), usePathname: () => '/ask' }));

const BASE: AskComposeProps = { qaState: null, degraded: null, live: { state: 'off', until: null }, real: { kind: 'not_configured' }, preset: null, from: null, edit: false, resend: null };

function setup(props: Partial<AskComposeProps> = {}) {
  return render(<AskCompose {...BASE} {...props} />);
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function sse(events: { event: string; data: unknown }[]): Response {
  const body = events.map((e, i) => `id: ${i + 1}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

beforeEach(() => {
  sessionStorage.clear();
  resetSampleStoreForTests();
  push.mockReset();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/ask compose', () => {
  it('server HTML is the empty SAMPLE compose (no storage, nothing staged)', () => {
    const html = renderToString(<AskCompose {...BASE} />).replace(/<!-- -->/g, '');
    expect(html).toContain('Ask the network');
    expect(html).toContain('Sample · 40 fictional members');
    expect(html).toContain('Sent as a sample founder at Arrecife Data (Seed, Mexico City).');
    expect(html).toContain('0 / 600');
    expect(html).toMatch(/data-primary=""[^>]*>Check my ask/);
  });

  it('the Missing 2 parts sample → Check → Use all → the card a member gets → Send to the tab', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Missing 2 parts' }));
    const sa = SAMPLE_NETWORK_ASKS.engineer;
    expect((screen.getByLabelText('What do you need?') as HTMLTextAreaElement).value).toBe(sa.partial);
    fireEvent.click(document.getElementById('ask-check')!);
    expect(screen.getByText('5 parts · 2 found · 1 suggested · 2 missing')).toBeTruthy();
    expect(screen.getByText('Example parts, written by hand · not a compiler run')).toBeTruthy();
    // Example parts never touch the compiler.
    expect(fetch).not.toHaveBeenCalled();
    expect(document.getElementById('ask-send')!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Use all 3 suggestions' }));
    expect((screen.getByLabelText('Subject, as members see it in their inbox') as HTMLInputElement).value).toBe(sa.subject);
    const card = document.querySelector('#ask-preview .offer-card')!;
    const facts = [...card.querySelectorAll('dt')].map((d) => d.textContent);
    expect(facts).toEqual(['Problem', 'Needs', 'Tried', 'By', 'Offers']);
    expect(card.textContent).toContain('20 minutes with someone who has run Postgres past 100M rows');
    expect(card.textContent).toContain('Matched your rule: “founders about Postgres, queues or LLM evals in production”');
    const send = document.getElementById('ask-send')!;
    expect(send.getAttribute('aria-disabled')).toBe('false');
    expect(send.hasAttribute('data-primary')).toBe(true);
    expect(document.getElementById('ask-check')!.hasAttribute('data-primary')).toBe(false);
    fireEvent.click(send);
    expect(push).toHaveBeenCalledWith('/ask/sa_eng');
    const run = getRun('sa_eng')!;
    expect(run).toMatchObject({ outcome: 'ready', sample_ask_id: 'sa_eng', text: sa.partial, you: null });
    expect(run.compiled.text).toBe(sa.complete);
  });

  it('editing after a check: rows go stale, the card hides, Check is the primary again', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    fireEvent.click(document.getElementById('ask-check')!);
    expect(document.getElementById('ask-preview')!.hidden).toBe(false);
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: `${SAMPLE_NETWORK_ASKS.engineer.complete} More.` } });
    expect(document.getElementById('ask-parts')!.className).toContain('is-stale');
    expect(document.getElementById('ask-preview')!.hidden).toBe(true);
    expect(screen.getByText(/Your text changed\. Check again/)).toBeTruthy();
    expect(document.getElementById('ask-check')!.hasAttribute('data-primary')).toBe(true);
    expect(document.getElementById('ask-send')!.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById('ask-actions-meta')!.textContent).toBe('Check again before sending.');
  });

  it('your own text without a model key: the manual 5-part form, no request, and Send explains why it waits', () => {
    setup();
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Our checkout drops 4% of card payments at 3DS. Tried two processors.' } });
    fireEvent.click(document.getElementById('ask-check')!);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('The compiler is off on this instance: no model API key is set. Fill the 5 parts yourself; your text is kept.')).toBeTruthy();
    for (const [label, value] of [
      ['What’s blocked, in one line?', 'Checkout drops 4% of card payments at 3DS'],
      ['What have you tried so far?', 'two processors'],
      ['Who could unblock it?', 'someone who ran payments at a marketplace'],
      ['By when do you need this?', 'Dec 4'],
      ['What can you give the person in return?', 'our 3DS failure logs'],
    ]) fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    expect((screen.getByLabelText('Subject, as members see it in their inbox') as HTMLInputElement).value).toBe('Checkout drops 4% of card payments, 20 min?');
    expect(document.getElementById('ask-send')!.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById('ask-actions-meta')!.textContent).toMatch(/^Live checks are off on this instance \(no model API key is set\), so only the 3 sample asks can go to the sample network\./);
  });

  it('without a model key, a vague ask is still refused by the compiler’s own code rule (no request, no manual form)', () => {
    setup();
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Need help please' } });
    fireEvent.click(document.getElementById('ask-check')!);
    expect(screen.getByText('Too vague to send.')).toBeTruthy();
    expect(document.getElementById('ask-parts')!.hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Vague' }));
    fireEvent.click(document.getElementById('ask-check')!);
    expect(screen.getByText('Too vague to send.')).toBeTruthy();
    expect(screen.queryByText(/written by hand/)).toBeNull();
    expect(screen.queryByText(/Fill the 5 parts yourself/)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('with live checks on, the Vague sample goes to the server, which refuses it by code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sse([
      { event: 'plan', data: { draft_id: 'd_2', words: 11, network: 'sample' } },
      { event: 'refused', data: { kind: 'vague', message: 'Too vague to send.' } },
    ])));
    setup({ live: { state: 'ok', until: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Vague' }));
    fireEvent.click(document.getElementById('ask-check')!);
    await flush();
    expect(fetch).toHaveBeenCalledWith('/api/compile', expect.objectContaining({ body: JSON.stringify({ text: SAMPLE_NETWORK_ASKS.engineer.vague, network: 'sample' }) }));
    expect(screen.getByText('Too vague to send.')).toBeTruthy();
    expect(document.getElementById('ask-parts')!.hidden).toBe(true);
  });

  it('a check while the API was down at render still tries the compiler, and falls back to the manual form', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'live_unavailable', live: 'down', until: null }, 503)));
    setup({ live: { state: 'down', until: null } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Our checkout drops 4% of card payments at 3DS. Tried two processors.' } });
    fireEvent.click(document.getElementById('ask-check')!);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The compiler isn’t answering. Fill the 5 parts yourself; your text is kept.')).toBeTruthy();
  });

  it('with the compiler up, a live check streams the parts in', async () => {
    const parts = [
      { key: 'challenge', state: 'found', text: 'x', source: [{ text: 'Checkout drops 4% of card payments', found: true, start: 4, end: 38 }], question: null },
      { key: 'tried', state: 'found', text: 'two processors', source: [{ text: 'two processors', found: true, start: 52, end: 66 }], question: null },
      { key: 'needs', state: 'suggested', text: 'someone who has run payments at a marketplace', source: [{ text: 'card payments', found: true, start: 25, end: 38 }], question: null },
      { key: 'by', state: 'missing', text: '', source: [], question: 'By when do you need this?' },
      { key: 'offers', state: 'missing', text: '', source: [], question: null },
    ];
    const events = [
      { event: 'plan', data: { draft_id: 'd_1', words: 12, network: 'sample' } },
      ...parts.map((part, i) => ({ event: 'part', data: { i, part } })),
      { event: 'done', data: { draft_id: 'd_1', subject: 'Card payments failing at 3DS, 20 min?', topic: 'Payments', parts, ms: 2100 } },
    ];
    const body = events.map((e, i) => `id: ${i + 1}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    setup({ live: { state: 'ok', until: null } });
    const text = 'Our checkout drops 4% of card payments at 3DS. Tried two processors.';
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: text } });
    fireEvent.click(document.getElementById('ask-check')!);
    await flush();
    await flush();
    expect(fetch).toHaveBeenCalledWith('/api/compile', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByText('5 parts · 2 found · 1 suggested · 2 missing')).toBeTruthy();
    // Found parts show the founder's own words at the offsets, not the model's copy.
    expect(screen.getByText('“checkout drops 4% of card payments”')).toBeTruthy();
    expect(screen.getByText('suggested from “card payments”')).toBeTruthy();
    expect(screen.queryByText('Example parts, written by hand · not a compiler run')).toBeNull();
  });

  it('YC applications are refused by code before any request', () => {
    setup({ live: { state: 'ok', until: null } });
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Need 20 minutes with a YC alum to review our YC application before the batch deadline.' } });
    fireEvent.click(document.getElementById('ask-check')!);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Asks about YC applications aren’t sent.')).toBeTruthy();
  });

  it('REAL is unavailable here and says why when pressed', () => {
    setup();
    const real = screen.getByRole('radio', { name: 'Real' });
    expect(real.getAttribute('aria-disabled')).toBe('true');
    expect(document.getElementById('ask-real-note')!.hidden).toBe(true);
    fireEvent.click(real);
    expect(document.getElementById('ask-real-note')!.hidden).toBe(false);
    expect(document.getElementById('ask-real-why')!.textContent).toBe('The real network isn’t set up on this instance.');
    expect(screen.getByRole('radio', { name: 'Sample · 40 fictional members' }).getAttribute('aria-checked')).toBe('true');
  });

  it('the keyboard reaches the unavailable Real option too, and hears why', () => {
    setup();
    const sample = screen.getByRole('radio', { name: 'Sample · 40 fictional members' });
    const real = screen.getByRole('radio', { name: 'Real' });
    sample.focus();
    fireEvent.keyDown(sample, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(real);
    expect(document.getElementById('ask-real-note')!.hidden).toBe(false);
    expect(real.getAttribute('aria-describedby')).toBe('ask-real-why');
    expect(sample.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(real, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(sample);
  });

  it('signed in with a profile: REAL shows who it is sent as', async () => {
    setup({ real: { kind: 'allowed', profile: { name: 'Ana Ruiz', first: 'Ana', company: 'Clínica Norte', stage: 'Seed', city: 'Monterrey' } }, live: { state: 'ok', until: null } });
    fireEvent.click(screen.getByRole('radio', { name: 'Real' }));
    expect(document.getElementById('ask-as')!.textContent).toContain('Sent as Ana Ruiz, Clínica Norte (Seed, Monterrey).');
    expect(document.getElementById('ask-samples')!.hidden).toBe(true);
  });

  it('arriving from the playground fills that preset’s Missing 2 parts sample', async () => {
    sessionStorage.setItem('oti.playground', JSON.stringify({ v: 1, preset: 'health', rules: 'x', cap: 2, edited: false, run_id: null, ran_at: null, mode: null, run_rules: null, results: [], marks: [] }));
    setup({ from: 'playground' });
    await flush();
    expect((screen.getByLabelText('What do you need?') as HTMLTextAreaElement).value).toBe(SAMPLE_NETWORK_ASKS.health.partial);
    expect(document.getElementById('ask-as')!.textContent).toContain('Orvella Health (Seed, Guadalajara)');
  });

  it('keeps what you typed in this tab', async () => {
    setup();
    fireEvent.change(screen.getByLabelText('What do you need?'), { target: { value: 'Draft text' } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(JSON.parse(sessionStorage.getItem('oti.s2.draft')!)).toEqual({ v: 1, text: 'Draft text' });
    cleanup();
    setup();
    await flush();
    expect((screen.getByLabelText('What do you need?') as HTMLTextAreaElement).value).toBe('Draft text');
    cleanup();
    // “‹ New ask” (?new=1) starts empty and forgets the draft.
    window.history.replaceState(null, '', '/ask?new=1');
    setup({ fresh: true });
    await flush();
    expect((screen.getByLabelText('What do you need?') as HTMLTextAreaElement).value).toBe('');
    expect(sessionStorage.getItem('oti.s2.draft')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('QA states render the prototype’s designed states', async () => {
    setup({ qaState: 'queued' });
    await flush();
    expect(screen.getByText('You have 3 open asks. This one sends when one of them closes.')).toBeTruthy();
    expect(screen.getByText('Example profile for layout (QA state).')).toBeTruthy();
    cleanup();
    setup({ qaState: 'compiler-down' });
    await flush();
    expect(screen.getByText('The compiler isn’t answering. Fill the 5 parts yourself; your text is kept.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Use sample answer' })).toHaveLength(5);
  });
});
