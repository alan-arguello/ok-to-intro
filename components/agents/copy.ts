/**
 * /agents copy, verbatim from prototype/agents.html and ux-spec S6, except where the build is more exact:
 * - answer_question also runs without a token on SAMPLE asks (docs/CONTRACT.md §b), so the lines that named only
 *   send_ask name both;
 * - the transcripts are example transcripts written by hand around receipts the server's formatter renders from
 *   SAMPLE data (docs/CONTRACT.md §e.5), not recordings, so the caption says that.
 */
export const AGENTS_COPY = {
  title: 'Use it from Claude Code',
  lede: 'Your gate and the network as an MCP server, a /ask skill and a session hook.',
  description: 'Use OK to Intro from Claude Code: an MCP server, a /ask skill and a session hook. Install commands and the exact receipts its tools return.',

  install: 'Install',
  pluginTab: 'Plugin (recommended)',
  mcpTab: 'MCP only',
  copyPlugin: 'Copy the plugin install command',
  copyMarketplace: 'Copy the marketplace command',
  copyInstall: 'Copy the install command',
  copyMcp: 'Copy the MCP command',
  pluginHelp:
    'Claude Code 2.1.292+. Adds the MCP server, the /ask skill and the session hook. It asks for an optional token; without one, try_rules and draft_ask work, and send_ask and answer_question work on the SAMPLE network.',
  olderSummary: 'Older Claude Code: two steps',
  olderHelp: 'Inside a session, type /plugin instead of claude plugin.',
  mcpHelp: 'No account. Tested in Claude Code. try_rules and draft_ask work in any MCP client.',

  whatYouGet: 'What you get',
  getMcp: 'MCP server',
  getSkill: '/ask skill',
  getSkillWhat: 'drafts from your repo with sources; sends only after your yes',
  getHook: 'Session hook',
  getHookWhat: 'up to 3 lines when something waits on you; silent otherwise',

  seeItWork: 'See it work',
  demoAsk: 'Ask',
  demoAsked: 'Get asked',
  demoTry: 'Try your rules',
  showRest: 'Show the rest (the missing parts, send_ask, answer_question)',
  transcriptsCaption:
    'Example transcripts, written by hand. Every tool result in them is rendered by the server’s own receipt formatter from SAMPLE data. The people, companies and files are fictional.',

  tools: 'Tools',
  asksFirst: 'Always asks you first (requiresUserInteraction).',
  exampleResult: 'Example result',
  errors: 'Errors (isError)',

  hook: 'Session hook',
  hookRules: [
    'Runs at session start and resume, with a 2-second limit.',
    'Prints nothing unless something waits on you.',
    'At most 3 lines; each item at most twice.',
    'Never includes text written by other people.',
  ],
  hookCaption: 'Example lines; the ids and names are fictional.',
} as const;
