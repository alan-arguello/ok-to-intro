# Requests and notes from S6 (agents)

S6 built against the contract as written. Nothing below blocks anyone; each item says what S6 does meanwhile.

## 1. CodeBlock: a primary flag and an accessible name
- File: components/kit/code-block.tsx
- Change: add `primary?: boolean` (renders `data-primary` on the Copy button) and `ariaLabel?: string` (replaces the default “Copy: <command>” name).
- Why: on /agents the install command's Copy is the page's one primary (ux-spec §2.1: visible in the first viewport, ⌘↵ presses it, 44 px via tokens.css `.btn[data-primary]`), and the prototype names each button (“Copy the plugin install command”, “Copy the MCP command”, …).
- Blocking? No. components/agents/copy-command.tsx renders the same `.code` markup with the kit's `copyText` and `announce`.

## 2. Tabs: label by an existing heading
- File: components/kit/tabs.tsx
- Change: optional `labelledBy` (sets `aria-labelledby` on the tablist instead of `aria-label`), as the prototype does with the section's h2.
- Why: parity with agents.html (`aria-labelledby="ag-install-h"`). The panels are already focusable (`tabIndex={0}`), so S6 doesn't make the transcripts a second tab stop.
- Blocking? No. /agents passes the heading's text as `label`.

## 3. npm scripts for the plugin files
- File: package.json
- Change: `"plugin:build": "tsx scripts/build-plugin.ts"` and `"plugin:check": "tsx scripts/build-plugin.ts --check"`.
- Why: `.claude-plugin/marketplace.json`, `plugins/ok-to-intro/.claude-plugin/plugin.json`, `.mcp.json` and `hooks/hooks.json` carry the production origin and can't read env. They are generated from lib/site.ts; tests/agents/plugin.test.ts fails on hand edits and on a local or http origin. Run `plugin:check` with the production `NEXT_PUBLIC_SITE_URL` before tagging a release.
- Blocking? No: `NEXT_PUBLIC_SITE_URL=https://ok-to-intro.vercel.app npx tsx scripts/build-plugin.ts [--check]` works today; the committed files point at https://ok-to-intro.vercel.app.

## 4. Copy that differs from the prototype on purpose (for Alan or the integrator to confirm)
- File: components/agents/copy.ts, lib/receipts.ts (no shared file changes)
- “Recorded transcripts. The people, companies and files are fictional.” → “Example transcripts, written by hand. Every tool result in them is rendered by the server’s own receipt formatter from SAMPLE data. The people, companies and files are fictional.” (CONTRACT §e.5: not a recording).
- Example receipts on /agents carry SAMPLE in line 1 (receipt contract: “SAMPLE appears in line 1 whenever the data is sample data”) and a clock time from one example timeline (Mon Nov 9, 21:04 CST) instead of invented durations like “2.1 s” (§e.1, §gotchas.2).
- try_rules on a preset without live checks returns the preset's file and says so: line 1 ends “example verdicts”, and the 4th line is AUTHORED_LABEL plus why it isn't live. The “Try your rules” transcript shows that receipt.
- send_ask without a token passes `you: null` (CONTRACT §b), so BE2's 40th cell is a hand-written member that declines. The Ask transcript therefore reads “40 members · 2 accepted · 1 question · 30 declined” and the answer reaches “the gate that asked” (the prototype counted the visitor's own gate: 3 accepted, 2 questions). Authored fan-outs say AUTHORED_FANOUT_LABEL and never “33 gates ran”.
- answer_question also runs without a token on `sa_…` asks (CONTRACT §b), so “What you get” and the plugin help name send_ask and answer_question, and the tool list tags both “Sample: open”.
- The hook example gets a caption: “Example lines; the ids and names are fictional.”
- “No account. Tested in Claude Code.” (MCP-only help, prototype copy) is kept. The server was exercised over Streamable HTTP with raw JSON-RPC (initialize, tools/list, tools/call) and the plugin passes `claude plugin validate --strict` in Claude Code 2.1.301, but no Claude Code session was connected to it here (that would change user settings or spend model usage). Run ux-spec §8 smoke step 6 (both install commands in a clean Claude Code profile) against the deployed site before the email.

## 5. Telling a bad token from a database outage
- File: lib/server/api-tokens.ts (S3)
- Change (optional): a variant of `verifyApiToken` that returns why it failed (`invalid` | `not_configured` | `db_down`).
- Why: it returns null for both a revoked token and a database that didn't answer. MCP token tools say “didn’t verify” vs “Something broke on our side”, so S6 asks BE1's `getHealth()` (cached db probe) after a null. The hook stays silent either way.
- Blocking? No.

## 6. Contract notes (no change requested)
- send_ask on SAMPLE calls BE2 `startSampleSendWith(input, context, { replay: false })` (exported next to `startSampleSend`): an MCP receipt has no use for replay timing.
- try_rules and set_rules pass `mode: 'auto'` to `startTry` with a cast (BE1 request §1). Receipts read `plan.mode` and each gate's `source`.
- SAMPLE answer_question finds the question type from BE2's id scheme (`q_` + hex4(`<ask id>:<type>`)); if BE2 changes it, `lib/mcp/sample.ts` `questionTypeFor` must follow.
- `/mcp` never answers 401: missing or bad tokens are tool results, so Claude Code never starts OAuth against it. The Vercel WAF rule in ux-spec §8 lists `/api/try` and `/api/asks/*`; consider `/mcp` too (token tools also use the `mcp` bucket, 60 per 10 minutes, via `checkRateLimit`).
