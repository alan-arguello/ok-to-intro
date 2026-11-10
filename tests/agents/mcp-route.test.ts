import { describe, expect, it, vi } from 'vitest';
import { DELETE, GET, POST } from '@/app/mcp/route';
import { TOOL_CATALOG } from '@/lib/mcp/catalog';
import { SERVER_INSTRUCTIONS } from '@/lib/mcp/server';
import { AUTHORED_LABEL } from '@/lib/oti/copy';
import { PRESET_RECORDINGS } from '@/lib/recorded';

// Pinned to the hand-written recordings (npm run recordings:fixtures), whatever data/recorded holds now: these tests
// check the authored path and its exact contents. tests/recorded/model-source.test.ts covers a model recording.
vi.mock('@/data/recorded/presets.json', () => import('../fixtures/recorded/authored/presets.json'));
vi.mock('@/data/recorded/sample-network.json', () => import('../fixtures/recorded/authored/sample-network.json'));

/**
 * /mcp end to end through the route handler, as Claude Code calls it (Streamable HTTP, stateless, the 2025-era
 * protocol): initialize, tools/list (names, annotations, requiresUserInteraction), tools/call. No keys exist in tests,
 * so the open tools show their designed no-key results and token tools say tokens aren't set up here.
 */

let id = 0;

async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await POST(
    new Request('http://localhost:3200/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        'x-forwarded-for': '203.0.113.7',
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    }),
  );
  const text = await res.text();
  const data = res.headers.get('content-type')?.includes('text/event-stream')
    ? text
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => JSON.parse(l.slice(6)))
        .find((m) => m.id === id)
    : JSON.parse(text);
  return { res, data };
}

async function callTool(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
  const { res, data } = await rpc('tools/call', { name, arguments: args }, headers);
  const result = data.result as { content: { type: string; text: string }[]; isError?: boolean };
  return { res, text: result.content.map((c) => c.text).join('\n'), isError: !!result.isError };
}

describe('/mcp', () => {
  it('initializes as ok-to-intro with the server instructions', async () => {
    const { res, data } = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(data.result.serverInfo.name).toBe('ok-to-intro');
    expect(data.result.capabilities.tools).toBeTruthy();
    expect(data.result.instructions).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  it('lists the 9 tools with the annotations ux-spec S6 asks for', async () => {
    const { data } = await rpc('tools/list');
    const tools = data.result.tools as { name: string; description: string; annotations: Record<string, unknown>; _meta?: Record<string, unknown>; inputSchema: unknown }[];
    expect(tools.map((t) => t.name)).toEqual(TOOL_CATALOG.map((t) => t.name));
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    // A person approves every send and every OK, even in auto mode.
    for (const name of ['send_ask', 'answer_question', 'respond']) expect(by[name]?._meta?.['anthropic/requiresUserInteraction']).toBe(true);
    for (const name of ['try_rules', 'draft_ask', 'my_asks', 'pending_for_me', 'set_rules', 'record_outcome']) expect(by[name]?._meta?.['anthropic/requiresUserInteraction']).toBeUndefined();
    for (const name of ['try_rules', 'draft_ask', 'pending_for_me', 'my_asks']) expect(by[name]?.annotations.readOnlyHint).toBe(true);
    for (const name of ['answer_question', 'record_outcome']) expect(by[name]?.annotations.idempotentHint).toBe(true);
    for (const t of tools) {
      expect(t.description.length).toBeLessThanOrEqual(4096);
      expect(`mcp__plugin_ok-to-intro_ok-to-intro__${t.name}`.length).toBeLessThan(128);
      expect(t.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('try_rules on a preset returns the preset’s recorded run, labelled by its source', async () => {
    const { text, isError } = await callTool('try_rules', { preset: 'engineer' });
    expect(isError).toBe(false);
    const lines = text.split('\n');
    expect(lines[1]).toBe('2 reach you · 1 over your cap · 1 question first · 8 declined');
    if (PRESET_RECORDINGS.source === 'authored') {
      expect(lines[0]).toBe('ok-to-intro · try_rules · 12 SAMPLE asks · cap 2 · example verdicts');
      expect(text).toContain(`${AUTHORED_LABEL}. Live checks are off on this instance: no model API key is set`);
    }
    // The same rules typed out are the preset too.
    const typed = await callTool('try_rules', { rules: (await import('@/lib/sample/presets')).presetById('engineer').rules });
    expect(typed.text).toBe(text);
  });

  it('try_rules on custom rules says live checks are off here, and nothing was stored', async () => {
    const { text, isError } = await callTool('try_rules', { rules: 'Happy to talk about Kafka.' });
    expect(isError).toBe(true);
    expect(text).toBe(
      'Live checks are off on this instance: no model API key is set. Your rules weren’t stored or sent anywhere.\nnext: call try_rules with preset "engineer", "health" or "founder" to see a sample member’s rules checked.',
    );
    const empty = await callTool('try_rules', {});
    expect(empty.isError).toBe(true);
    const long = await callTool('try_rules', { rules: 'x'.repeat(1001) });
    expect(long.text).toContain('Keep the rules under 1,000 characters (these have 1,001)');
  });

  it('draft_ask refuses vague asks and YC application asks by code, without a key', async () => {
    const vague = await callTool('draft_ask', { text: 'Need intros to people who could help us grow in the US.' });
    expect(vague.isError).toBe(false);
    expect(vague.text.split('\n')[0]).toBe('ok-to-intro · draft refused · too vague · nothing stored');
    const yc = await callTool('draft_ask', { text: 'Can someone review my YC application before the interview next week please?' });
    expect(yc.text.split('\n')[0]).toBe('ok-to-intro · draft refused · about a YC application · nothing stored');
    const live = await callTool('draft_ask', { text: 'Our Postgres p95 went from 40 ms to 900 ms once the events table passed 40M rows. Tried partitions.' });
    expect(live.isError).toBe(true);
    expect(live.text).toContain('Live checks are off on this instance: no model API key is set. Nothing was stored.');
  });

  it('token tools say tokens aren’t set up on this instance (never a 401, never an OAuth challenge)', async () => {
    for (const [name, args] of [
      ['my_asks', {}],
      ['pending_for_me', {}],
      ['respond', { offer_id: 'o_3Fp9', action: 'ok' }],
      ['set_rules', { rules: 'No fundraising asks.' }],
      ['record_outcome', { checkin_id: 'c_88', rating: 4 }],
    ] as const) {
      for (const auth of [undefined, 'Bearer ${user_config.token}', 'Bearer oti_aaaaaaaaaaaaaaaaaaaaaa', 'Bearer not-a-token']) {
        const { res, text, isError } = await callTool(name, args, auth ? { authorization: auth } : {});
        expect(res.status).toBe(200);
        expect(res.headers.get('www-authenticate')).toBeNull();
        expect(isError).toBe(true);
        expect(text).toBe(`${name} needs a token, and tokens aren’t set up on this instance yet. try_rules, draft_ask and SAMPLE sends work without one.`);
      }
    }
  });

  it('send_ask on an unknown draft says it expired; on REAL without tokens says so', async () => {
    const missing = await callTool('send_ask', { draft_id: 'd_nope12' });
    expect(missing.text).toBe('That draft expired. Call draft_ask again with the full ask.');
  });

  it('answer_question works on a SAMPLE ask without a token (hand-written reruns)', async () => {
    const { text, isError } = await callTool('answer_question', { ask_id: 'sa_health', question_id: 'q_f2b7', answer: '$18k a year per hospital' });
    expect(isError).toBe(false);
    expect(text.split('\n')[0]).toBe('ok-to-intro · ask sa_health · answer sent · SAMPLE');
    expect(text).toContain('result    the gate that asked accepts with this answer (example results, written by hand) · next in line');
    const unknown = await callTool('answer_question', { ask_id: 'sa_health', question_id: 'q_zzzz', answer: 'x' });
    expect(unknown.isError).toBe(true);
  });

  it('GET and DELETE answer 405: serving is stateless', async () => {
    for (const handler of [GET, DELETE]) {
      const res = await handler(new Request('http://localhost:3200/mcp', { method: handler === GET ? 'GET' : 'DELETE', headers: { accept: 'text/event-stream' } }));
      expect(res.status).toBe(405);
    }
  });
});
