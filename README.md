# OK to Intro

A founder asks a network of members for one specific person. Each member's gate, a small model running rules that
member wrote, checks the ask, and only asks that pass the gate and fit under the member's monthly cap ever reach them.

> Independent project, not affiliated with Y Combinator.

## How it works

- **The gate.** Every member writes plain-text rules (“founders about Postgres, queues or LLM evals in production”).
  For each ask, `claude-haiku-5-5` returns a structured verdict: accept, decline or ask back one short question.
  It must quote the line of the rules it relied on. The ask is passed to the model as quoted data, never as
  instructions.
- **The clause check.** Code looks for every quote in the member's rules with one shared finder
  (`lib/oti/clause.ts`: NFKC, straight quotes, collapsed whitespace, case-folded, one contiguous span, widened to
  whole words). A quote that isn't there turns the verdict into a decline (“decided by code”). The read view
  highlights the member's own words at the offsets the server found.
- **Caps.** Each member sets how many asks a month they'll take (1–5). Postgres enforces it: `create_offer` calls
  `reserve_slot` under a row lock in the same transaction, so two asks can't take a member's last slot.
- **One person at a time.** Of the members who accept, the one with the most unused cap gets the offer. They have
  72 hours to say OK, answer in 2 lines, or pass. A pass is private. The next accept gets the ask, and the asker
  only learns at the next 09:00/21:00 checkpoint, so a pass can't be told from an expiry. Names are exchanged only
  after an OK, in one intro email to both people.
- **The compiler.** `/ask` turns a founder's text into 5 parts (the challenge, what they tried, who they need, by
  when, what they offer) with `claude-sonnet-5-5`. Each part is marked found, suggested or missing; facts are never
  invented. Vague asks and YC-application asks are refused.
- **Check-ins.** At +1 day both people say whether the call happened and how useful it was. At +14 days the asker
  reports the outcome. Those answers are the only source of the public board's outcome counts.
- **Fail closed.** A gate that fails counts as “not checked”, never as an accept. If more than 1 in 5 gates fail, the
  ask offers nothing.

## Architecture

- Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, meant for Vercel (Node runtime).
- Supabase Postgres with RLS on every table and email-code (OTP) sign-in. All writes go through the service role
  and `net_*` SQL functions (`supabase/migrations`). The asker serializer (`lib/server/serializer.ts`) is the only
  path from internal state to an asker.
- Anthropic: `claude-haiku-5-5` for gates, `claude-sonnet-5-5` for the compiler, `claude-opus-5-5` only in offline
  scripts. A daily budget and per-address rate limits are enforced in the app.
- Resend for email (idempotency keys, scheduled check-ins), with a daily Vercel Cron as the backstop.
- `/mcp` is a stateless MCP server (Streamable HTTP, `mcp-handler`). `plugins/ok-to-intro` is a Claude Code
  plugin with an `/ask` skill and a SessionStart hook.
- `/`, `/how`, `/privacy` and `/agents` are static; `/board` regenerates every 60 s; token pages (`/o`, `/c`,
  `/pause`) work without JavaScript.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (layout, flows, decisions) and
[docs/CONTRACT.md](docs/CONTRACT.md) (interfaces, event shapes, privacy and honesty rules).

## Run locally

Requires Node 22.22+ or 24.15+ and npm.

```sh
npm install
cp .env.example .env.local   # optional
npm run dev                  # http://localhost:3200
```

Every page works without keys: the SAMPLE flows run fully, and every REAL feature shows its own “not set up on this
instance” state. Features switch on when their variables appear.

## Environment variables

| Variable | Turns on |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | The origin used for every absolute URL, email link, install command and receipt |
| `ANTHROPIC_API_KEY` | Live gates on the playground, the live compiler, your own gate in the SAMPLE fan-out |
| `DAILY_BUDGET_USD` | The app's daily model budget (default 10) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Sign-in, Your gate, the board |
| `TOKEN_HMAC_SECRET` | Email-link and Claude Code tokens (only HMACs are stored) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email. The REAL network needs the database, the token secret and email together |
| `CRON_SECRET` | `/api/cron/daily` and `/api/cron/warm` |
| `RATE_LIMIT_SALT_SECRET` | Rate limits shared across server instances (otherwise per instance) |
| `REAL_ASKERS` | Unset or `*`: every signed-in member can ask the REAL network. A list of emails: only those |
| `NEXT_PUBLIC_CONTACT_EMAIL` | The contact line on /privacy |
| `QA_STATES` | `1` honours `?state=` and `?degraded=` QA controls in production (always on in dev) |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on :3200 (dist dir `.next-dev`) |
| `npm run check` | Typecheck, lint and tests (vitest; PGlite runs the real migrations for the database tests) |
| `npm run build:check` | A production build in a throwaway dist dir |
| `npm run record:presets` | Records the 3 playground presets and the 39 sample members with the production gate (needs `ANTHROPIC_API_KEY`). `--check` verifies recordings against the current rubric |
| `npm run eval` | The held-out eval; writes `data/eval/heldout-summary.json`, which /board and /how read |
| `npm run bench` | Measures gate latency and cost |
| `npm run race` | 20 concurrent offers for 1 free slot must produce exactly 1 (needs a Supabase dev project; otherwise it runs a logical check, prints SKIPPED and exits 2) |
| `npm run smoke` | Pre-deploy smoke test: playground, ask → offered, offer → intro, board, degraded banners, links |
| `npm run audit` | Headless-Chrome audit of every route and QA state at 1280×900 and 375×812 (console errors, overflow, contrast, labels, primaries) |
| `npm run check:links` | Fails on placeholder domains and links to missing repo files |
| `npm run plugin:build` / `plugin:check` | Regenerates or checks the plugin JSON for `NEXT_PUBLIC_SITE_URL` |

## Honesty notes

- **SAMPLE data is fictional.** The 12 playground asks, the 39 sample members, their companies and every email
  shown at `/emails` are made up (`lib/sample`). Pages that use them carry a Sample tag.
- **No verdict in this repo comes from a model yet.** `data/recorded/presets.json` and
  `data/recorded/sample-network.json` are `"source": "authored"`: hand-written expectations, labelled “written by
  hand · not a model run” wherever they show. `npm run record:presets` replaces them with real recordings
  (`"source": "model"`, with model, rubric hash, timings and cost); the UI then labels them “recorded” and replays
  them at their recorded speed.
- **Live means live.** A row labelled live came from a model call made for that visitor, in that moment.
- **The board shows only database counts.** Without a database it says the real network isn't connected and shows
  no numbers. The example numbers in its QA states are labelled as prototype layout. The eval section reads
  `"No eval run yet"` until `npm run eval` writes a summary.
- **Costs are estimates** (“about …, estimated from published prices”) until `npm run bench` measures them.
- **The /agents transcripts are written by hand.** Every tool result in them is rendered by the server's own
  receipt formatter from SAMPLE data.

## What needs keys

- Live playground runs, the live compiler and your own gate in the SAMPLE fan-out: `ANTHROPIC_API_KEY`.
- Sign-in, Your gate, REAL asks, offers, intros, check-ins, pause links, Claude Code tokens and board numbers: the
  three Supabase variables, `TOKEN_HMAC_SECRET`, `RESEND_API_KEY` and `EMAIL_FROM`. Supabase Auth must send a
  6-digit code (`{{ .Token }}`) in both the Magic Link and Confirm signup templates.
- The daily backstop: `CRON_SECRET` (see `vercel.json`).

## License

MIT © 2026 Alan Arguello. See [LICENSE](LICENSE).
