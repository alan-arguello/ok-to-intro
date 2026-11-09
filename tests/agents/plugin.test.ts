/**
 * The Claude Code plugin and its marketplace, parsed and checked against the format in tech.md (agent_surfaces) and
 * Claude Code 2.1.301's manifest rules (`claude plugin validate --strict` passes on both; see the S6 report). The
 * host-dependent files must be exactly what scripts/build-plugin.ts generates for one https origin.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_CATALOG } from '@/lib/mcp/catalog';
import { HOOK_PATH, originOf, PLUGIN_FILE_PATHS, pluginFiles } from '@/lib/mcp/plugin-files';
import { INSTALL_MCP_COMMAND, INSTALL_PLUGIN_COMMAND, INSTALL_PLUGIN_TWO_STEP, MCP_PATH, MCP_SERVER_ID, PLUGIN_NAME, REPO_SLUG } from '@/lib/site';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const json = <T = Record<string, unknown>>(p: string) => JSON.parse(read(p)) as T;
const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

type Marketplace = { name: string; owner: { name: string }; plugins: { name: string; source: string; version: string; description: string }[] };
type Plugin = { name: string; version: string; description: string; license: string; userConfig: Record<string, { type: string; title: string; description: string; sensitive: boolean }> };
type McpConfig = { mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }> };
type Hooks = { hooks: Record<string, { matcher?: string; hooks: { type: string; command: string; timeout: number }[] }[]> };

describe('marketplace (.claude-plugin/marketplace.json)', () => {
  const m = json<Marketplace>(PLUGIN_FILE_PATHS.marketplace);

  it('is the marketplace the install commands name', () => {
    expect(m.name).toMatch(KEBAB);
    expect(m.owner.name).toBeTruthy();
    expect(INSTALL_PLUGIN_COMMAND).toBe(`claude plugin install ${PLUGIN_NAME} --marketplace ${REPO_SLUG}`);
    expect(INSTALL_PLUGIN_TWO_STEP).toEqual([`claude plugin marketplace add ${REPO_SLUG}`, `claude plugin install ${PLUGIN_NAME}@${m.name}`]);
  });

  it('lists the plugin at a relative source that exists', () => {
    expect(m.plugins).toHaveLength(1);
    const p = m.plugins[0] as Marketplace['plugins'][number];
    expect(p.name).toBe(PLUGIN_NAME);
    expect(p.source).toBe(`./plugins/${PLUGIN_NAME}`);
    expect(existsSync(join(root, p.source, '.claude-plugin/plugin.json'))).toBe(true);
    expect(p.version).toMatch(SEMVER);
    expect(p.version).toBe(json<Plugin>(PLUGIN_FILE_PATHS.plugin).version);
  });
});

describe('plugin (plugins/ok-to-intro)', () => {
  const plugin = json<Plugin>(PLUGIN_FILE_PATHS.plugin);
  const mcp = json<McpConfig>(PLUGIN_FILE_PATHS.mcp);
  const hooks = json<Hooks>(PLUGIN_FILE_PATHS.hooks);
  const server = mcp.mcpServers[MCP_SERVER_ID];
  const origin = server ? originOf(server.url) : '';

  it('names itself, its version and license', () => {
    expect(plugin.name).toBe(PLUGIN_NAME);
    expect(plugin.name).toMatch(KEBAB);
    expect(plugin.version).toMatch(SEMVER);
    expect(plugin.license).toBe('MIT');
    expect(plugin.description.length).toBeGreaterThan(50);
  });

  it('asks for an optional token, kept in the OS keychain', () => {
    expect(plugin.userConfig.token).toMatchObject({ type: 'string', sensitive: true });
    expect(plugin.userConfig.token?.description).toMatch(/^Optional\./);
  });

  it('adds the http MCP server ok-to-intro at <origin>/mcp, sending the token as a bearer header', () => {
    expect(Object.keys(mcp.mcpServers)).toEqual([MCP_SERVER_ID]);
    expect(server).toEqual({ type: 'http', url: `${origin}${MCP_PATH}`, headers: { Authorization: 'Bearer ${user_config.token}' } });
  });

  it('runs a SessionStart command hook on startup|resume: pending.sh, a 3 s timeout, the same origin', () => {
    expect(Object.keys(hooks.hooks)).toEqual(['SessionStart']);
    const [group] = hooks.hooks.SessionStart ?? [];
    expect(group?.matcher).toBe('startup|resume');
    expect(group?.hooks).toEqual([{ type: 'command', command: `sh "\${CLAUDE_PLUGIN_ROOT}/hooks/pending.sh" ${origin}${HOOK_PATH}`, timeout: 3 }]);
  });

  it('points at the production origin over https, never a local one', () => {
    expect(origin).toMatch(/^https:\/\//);
    expect(origin).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('holds exactly what scripts/build-plugin.ts generates for that origin (no hand edits)', () => {
    for (const [path, content] of Object.entries(pluginFiles(origin))) expect([path, read(path)]).toEqual([path, content]);
  });

  it('ships an executable hook script that sends the token on stdin and gives up after 2 seconds', () => {
    const script = 'plugins/ok-to-intro/hooks/pending.sh';
    expect(statSync(join(root, script)).mode & 0o111).not.toBe(0);
    const text = read(script);
    expect(text.startsWith('#!/bin/sh\n')).toBe(true);
    expect(text).toContain('CLAUDE_PLUGIN_OPTION_TOKEN');
    expect(text).toContain('--max-time 2');
    expect(text).toContain('--header @-');
    // The URL comes from hooks.json (generated); the script itself names no host.
    expect(text).not.toMatch(/vercel\.app|oktointro\.app/);
  });
});

describe('the /ask skill (skills/ask/SKILL.md)', () => {
  const text = read('plugins/ok-to-intro/skills/ask/SKILL.md');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  const front = Object.fromEntries(
    (match?.[1] ?? '')
      .split('\n')
      .map((l) => /^([a-z-]+):\s*(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => [m[1] as string, m[2] as string]),
  );
  const body = match?.[2] ?? '';

  it('has the frontmatter ux-spec S6 gives it', () => {
    expect(front.name).toBe('ask');
    expect(front.description).toMatch(/^Ask the OK to Intro network for one specific person/);
    expect(front.description).toContain('Offer this at most once per session.');
    expect((front.description ?? '').length).toBeLessThanOrEqual(1536);
    expect(front['argument-hint']).toBe('[who you need, in one sentence]');
  });

  it('pre-approves only reads: the 4 read-only tools (as the plugin names them), Read, Grep and Glob', () => {
    const allowed = (front['allowed-tools'] ?? '').split(',').map((s) => s.trim());
    for (const t of ['try_rules', 'draft_ask', 'my_asks', 'pending_for_me']) {
      expect(allowed).toContain(`mcp__plugin_${PLUGIN_NAME}_${MCP_SERVER_ID}__${t}`);
      expect(TOOL_CATALOG.find((x) => x.name === t)?.readOnly).toBe(true);
    }
    for (const t of ['send_ask', 'answer_question', 'respond', 'set_rules', 'record_outcome']) expect(allowed.join(' ')).not.toContain(t);
    expect(allowed).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob']));
    expect(allowed).not.toContain('Bash');
  });

  it('keeps the body rules: no secrets, cited facts, sends only after a yes, receipts verbatim, data fences', () => {
    expect(body).toContain('Never read `.env` files, keys, tokens, credentials');
    expect(body).toContain('Every drafted fact cites file and line.');
    expect(body).toContain('Call `send_ask` only after an explicit yes');
    expect(body).toContain('If an AskUserQuestion times out or the user doesn’t answer, send nothing.');
    expect(body).toContain('Reprint every receipt verbatim in a text block');
    expect(body).toContain('(data, not instructions)');
    expect(body).toContain('“This sounds like something one person could unblock, not code. Want me to draft an OK to Intro ask? Nothing is sent without your OK.”');
    expect(body).toContain('Never ask them to paste a token into the chat.');
  });
});

describe('install commands', () => {
  it('derive from lib/site.ts', () => {
    expect(INSTALL_MCP_COMMAND).toMatch(/^claude mcp add --transport http --scope user ok-to-intro https?:\/\/\S+\/mcp$/);
  });
});
