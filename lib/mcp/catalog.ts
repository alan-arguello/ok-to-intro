/**
 * The 9 MCP tools, as one catalog: the server registers them from here and /agents lists them from here, so the
 * page can't drift from what /mcp serves. Pure (no server imports): safe in a static page.
 *
 * Access (ux-spec S6, docs/CONTRACT.md §b “MCP tools → functions”): try_rules and draft_ask are open; the rest need
 * the member's token, except send_ask and answer_question on the SAMPLE network.
 * Annotations (tech.md agent_surfaces): `anthropic/requiresUserInteraction` on send_ask, answer_question and respond,
 * so a person approves every send and every OK, even in auto mode; readOnlyHint on try_rules, draft_ask,
 * pending_for_me and my_asks; idempotentHint on answer_question and record_outcome (server keys back them).
 */

export type ToolName =
  | 'try_rules'
  | 'draft_ask'
  | 'send_ask'
  | 'answer_question'
  | 'my_asks'
  | 'pending_for_me'
  | 'respond'
  | 'set_rules'
  | 'record_outcome';

export interface ToolEntry {
  name: ToolName;
  /** Human title (tools/list `title`). */
  title: string;
  access: 'open' | 'token';
  /** Works without a token on the SAMPLE network (send_ask, answer_question on `sa_…` ids). */
  sampleOpen: boolean;
  /** One line for /agents. */
  what: string;
  /** `_meta["anthropic/requiresUserInteraction"]`: Claude Code asks the person on every call, even in auto mode. */
  requiresUserInteraction: boolean;
  readOnly: boolean;
  idempotent: boolean;
}

export const TOOL_CATALOG: readonly ToolEntry[] = [
  {
    name: 'try_rules',
    title: 'Try your rules on 12 sample asks',
    access: 'open',
    sampleOpen: false,
    what: 'Runs your rules against the 12 SAMPLE asks and quotes the line behind each verdict. Rules are not stored.',
    requiresUserInteraction: false,
    readOnly: true,
    idempotent: false,
  },
  {
    name: 'draft_ask',
    title: 'Draft an ask (5 parts, nothing invented)',
    access: 'open',
    sampleOpen: false,
    what: 'Checks an ask for the 5 parts. Drafts a missing part only from sources you can check, and refuses vague asks and asks about YC applications.',
    requiresUserInteraction: false,
    readOnly: true,
    idempotent: false,
  },
  {
    name: 'send_ask',
    title: 'Send an approved ask',
    access: 'token',
    sampleOpen: true,
    what: 'Sends a draft you approved. Without a token it sends to the SAMPLE network only.',
    requiresUserInteraction: true,
    readOnly: false,
    idempotent: false,
  },
  {
    name: 'answer_question',
    title: 'Answer a gate’s question on your ask',
    access: 'token',
    sampleOpen: true,
    what: 'Sends your approved answer to the gates that asked; each reruns once.',
    requiresUserInteraction: true,
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'my_asks',
    title: 'Your asks',
    access: 'token',
    sampleOpen: false,
    what: 'Lists your asks and what each one waits on.',
    requiresUserInteraction: false,
    readOnly: true,
    idempotent: false,
  },
  {
    name: 'pending_for_me',
    title: 'What waits on you',
    access: 'token',
    sampleOpen: false,
    what: 'Shows offers that fit your rules, questions on your asks and check-ins that are due.',
    requiresUserInteraction: false,
    readOnly: true,
    idempotent: false,
  },
  {
    name: 'respond',
    title: 'Respond to an offer',
    access: 'token',
    sampleOpen: false,
    what: 'Records your OK, your 2-line answer or your No on an offer.',
    requiresUserInteraction: true,
    readOnly: false,
    idempotent: false,
  },
  {
    name: 'set_rules',
    title: 'Save your rules',
    access: 'token',
    sampleOpen: false,
    what: 'Saves new rules as a new version, after testing them on the 12 SAMPLE asks.',
    requiresUserInteraction: false,
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'record_outcome',
    title: 'Answer a check-in',
    access: 'token',
    sampleOpen: false,
    what: 'Saves your answer to a check-in.',
    requiresUserInteraction: false,
    readOnly: false,
    idempotent: true,
  },
];

export function toolEntry(name: ToolName): ToolEntry {
  const t = TOOL_CATALOG.find((x) => x.name === name);
  if (!t) throw new Error(`unknown tool ${name}`);
  return t;
}

export const OPEN_TOOL_COUNT = TOOL_CATALOG.filter((t) => t.access === 'open').length;
export const TOKEN_TOOL_COUNT = TOOL_CATALOG.length - OPEN_TOOL_COUNT;
