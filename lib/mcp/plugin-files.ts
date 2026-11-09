/**
 * The Claude Code plugin's host-dependent files, generated from one origin (scripts/build-plugin.ts passes SITE_URL;
 * JSON can't read env at runtime). Pure, so tests regenerate them and compare with what is committed:
 *
 *   .claude-plugin/marketplace.json                  the marketplace `alan-arguello/ok-to-intro` (name ok-to-intro)
 *   plugins/ok-to-intro/.claude-plugin/plugin.json   the plugin, with an optional sensitive `token` option
 *   plugins/ok-to-intro/.mcp.json                    the http MCP server `ok-to-intro` at <origin>/mcp
 *   plugins/ok-to-intro/hooks/hooks.json             SessionStart (startup|resume) → hooks/pending.sh <origin>/api/hook
 *
 * The rest of the plugin is static: skills/ask/SKILL.md, hooks/pending.sh, README.md.
 * Format (tech.md agent_surfaces; validated with `claude plugin validate --strict` in Claude Code 2.1.301):
 * `${user_config.token}` substitutes the option into the MCP headers; plugin hooks get it as CLAUDE_PLUGIN_OPTION_TOKEN.
 */

import { AUTHOR_NAME, MCP_PATH, MCP_SERVER_ID, PLUGIN_NAME, PRODUCT_NAME, REPO_SLUG, REPO_URL } from '@/lib/site';

export const PLUGIN_VERSION = '0.1.0';
export const HOOK_PATH = '/api/hook';
export const PLUGIN_DIR = `plugins/${PLUGIN_NAME}`;

export const PLUGIN_FILE_PATHS = {
  marketplace: '.claude-plugin/marketplace.json',
  plugin: `${PLUGIN_DIR}/.claude-plugin/plugin.json`,
  mcp: `${PLUGIN_DIR}/.mcp.json`,
  hooks: `${PLUGIN_DIR}/hooks/hooks.json`,
} as const;

const DESCRIPTION =
  'Ask a network for 20 minutes with one specific person from Claude Code, and answer what waits on you. Each member’s gate checks every ask against rules that member wrote. An MCP server, a /ask skill and a session hook.';

/** The origin, normalised: scheme and host only, no trailing slash. */
export function originOf(siteUrl: string): string {
  const u = new URL(siteUrl);
  return `${u.protocol}//${u.host}`;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function pluginFiles(siteUrl: string): Record<(typeof PLUGIN_FILE_PATHS)[keyof typeof PLUGIN_FILE_PATHS], string> {
  const origin = originOf(siteUrl);
  const homepage = `${origin}/agents`;
  return {
    [PLUGIN_FILE_PATHS.marketplace]: json({
      $schema: 'https://anthropic.com/claude-code/marketplace.schema.json',
      name: PLUGIN_NAME,
      description: `${PRODUCT_NAME}: consent-first intros from Claude Code.`,
      owner: { name: AUTHOR_NAME },
      plugins: [
        {
          name: PLUGIN_NAME,
          source: `./${PLUGIN_DIR}`,
          description: DESCRIPTION,
          version: PLUGIN_VERSION,
          author: { name: AUTHOR_NAME },
          category: 'productivity',
          homepage,
          repository: REPO_URL,
          license: 'MIT',
          keywords: ['intros', 'networking', 'founders', 'consent', 'mcp'],
        },
      ],
    }),
    [PLUGIN_FILE_PATHS.plugin]: json({
      name: PLUGIN_NAME,
      version: PLUGIN_VERSION,
      description: DESCRIPTION,
      author: { name: AUTHOR_NAME },
      homepage,
      repository: REPO_URL,
      license: 'MIT',
      keywords: ['intros', 'networking', 'founders', 'consent', 'mcp'],
      userConfig: {
        token: {
          type: 'string',
          title: `${PRODUCT_NAME} token`,
          description: `Optional. Create one under Your gate at ${origin}/me#token (shown once). Without it, try_rules and draft_ask work, and send_ask and answer_question run on the SAMPLE network.`,
          sensitive: true,
          default: '',
        },
      },
    }),
    [PLUGIN_FILE_PATHS.mcp]: json({
      mcpServers: {
        [MCP_SERVER_ID]: {
          type: 'http',
          url: `${origin}${MCP_PATH}`,
          headers: { Authorization: 'Bearer ${user_config.token}' },
        },
      },
    }),
    [PLUGIN_FILE_PATHS.hooks]: json({
      description: `${PRODUCT_NAME}: at most 3 lines at session start when something waits on you (an offer, a question on your ask, a check-in); silent otherwise.`,
      hooks: {
        SessionStart: [
          {
            matcher: 'startup|resume',
            hooks: [{ type: 'command', command: `sh "\${CLAUDE_PLUGIN_ROOT}/hooks/pending.sh" ${origin}${HOOK_PATH}`, timeout: 3 }],
          },
        ],
      },
    }),
  };
}

/** The repo slug the install commands name (`claude plugin install ok-to-intro --marketplace alan-arguello/ok-to-intro`). */
export const MARKETPLACE_SOURCE = REPO_SLUG;
