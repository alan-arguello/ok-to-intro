# OK to Intro

A way to ask a busy person for one specific thing: the ask is checked against rules that person wrote, and it reaches
them only if their own words let it through. Live demo: https://ok-to-intro.vercel.app

> Independent project, not affiliated with Y Combinator.

## The two sides

**Ask** (`/`). You write what you need: a short call, an intro, an answer or one concrete action.

- The compiler (one model call) splits the ask into 5 parts: the challenge, what you tried, who you need, a deadline
  and an offer back. It never invents facts: code checks each part against your message; a missing part is asked.
- Each member's gate is one small-model call. It reads the ask against the rules that member wrote and must quote
  the rule line it used. Code then checks that the quote is in the rules; if it is not, the answer is a decline.
- Each member sets a monthly cap. An ask that matches after the cap is reached does not reach them.
- One person at a time: one member who matched sees the ask. A no, or 72 quiet hours, moves it to the next one.

On `/rules` (“Be asked”) you write your own rules and a monthly limit, and see which of 12 sample asks would
reach you.

**Personal gate link** (`/g/<slug>`). From `/rules` you can save your rules and cap as a public link.

- Anyone can send an ask to the link. It is checked against your rules and your monthly cap before it reaches you.
- Asks that pass land in a private inbox, opened with an unguessable link. Only a SHA-256 of its key is stored.
- No accounts and no email. You read the inbox and reply to the asker yourself.
- Deleting the gate from the inbox deletes every ask sent to it.

## What is fictional and what is real

- Fictional: the 40 members, their rules and companies, and the sample asks (`lib/sample`). In the demo, nothing is
  sent to anyone.
- Real model runs: the recorded example runs in `data/recorded`, labelled with their date and model. A row labelled
  “live” came from a model call made for that visitor.
- Real and stored in Postgres: personal gates and the asks sent to them (name, email, text, verdict). See `/privacy`.

## Limits

- The gate checks what an ask says. It cannot detect lies.
- Losing the private inbox link loses access to that inbox. It cannot be recovered.
- Nothing is emailed: an accepted ask waits in the inbox until its owner opens it.
- Live checks stop at a daily model budget and at per-address rate limits.

## Stack and models

- Next.js 16 (App Router), React 19, TypeScript. Plain CSS with tokens in `app/tokens.css`.
- Postgres on Supabase, reached only from the server with the service role (`supabase/migrations`).
- Anthropic API: gates run on `claude-haiku-5-5` and the compiler on `claude-sonnet-5-5`, both with a fixed JSON
  schema. `claude-opus-5-5` is used only offline, to draft sample data and eval candidates.
- zod for input validation, Vitest for tests (PGlite for the SQL), Vercel for hosting.

## Environment variables

Copy `.env.example` to `.env.local`. Each feature switches on when its variables are present.

| Variable | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` | Live compiler and gate calls. Without it, only the recorded example runs play. |
| `ANTHROPIC_WORKSPACE_ID` | Optional. The workspace to bill, for keys not scoped to one. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Personal gates, with the API key for the checks. Apply `supabase/migrations` first. |
| `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL` | Optional. The origin used in links and previews; the contact on `/privacy`. |
| `DAILY_BUDGET_USD`, `RATE_LIMIT_SALT_SECRET`, `QA_STATES` | Optional. Daily model budget (default 10), shared rate-limit counters, QA states. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TOKEN_HMAC_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`, `REAL_ASKERS` | Only the parts listed under “Also in the repo”. The demo does not use them. |

## Run locally

```bash
npm install                  # Node ^22.22.2 or >=24.15.0
cp .env.example .env.local   # optional: the demo runs without keys
npm run dev                  # http://localhost:3200
```

## Scripts

- `npm run check`: typecheck, lint and tests (`npm run typecheck`, `npm run lint`, `npm test` run one each).
- `npm run build:check`: a production build in its own folder, so a running dev server is left alone.
- `npm run record:presets`: records the example runs again with the current rubric and model.
- `npm run eval`, `npm run bench`, `npm run race`: the gate eval, gate latency and cost, and the cap race test.
- `npm run smoke`, `npm run check:links`: checks against a running instance.
- `npm run plugin:build`: builds the Claude Code plugin in `plugins/ok-to-intro`.

## Also in the repo, not in the demo

- The multi-member network with sign-in, where each member keeps their own rules, cap and pause.
- Email offers and check-ins, and a board of counts from the database.
- The MCP server (`/mcp`) and the Claude Code plugin, to write and send asks from an editor.

## License

MIT. See `LICENSE`.
