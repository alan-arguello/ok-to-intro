# OK to Intro · architecture

A founder asks the network for one specific person. Each member's gate (a small model running the rules that
member wrote) checks the ask and must quote the line it used; code verifies the quote; Postgres enforces the
member's monthly cap; one person sees the ask at a time; names are exchanged after two human yeses; every intro is
followed to an outcome. This file explains how the code is laid out and why. `docs/CONTRACT.md` is the binding
interface between owners.

## Stack

- **Next.js 16 (App Router, Turbopack), React 19, TypeScript strict**, deployed on Vercel (Node runtime, `iad1`).
  No Cache Components: classic ISR (`revalidate`) for `/` (3600 s) and `/board` (60 s), dynamic rendering for
  token pages and signed-in pages. `proxy.ts` (Next 16's middleware) only refreshes Supabase sessions on
  `/me`, `/join`, `/ask/*`, `/api/asks/*`, `/o/*` and `/c/*` (every path that reads the session).
- **Supabase**: Postgres with RLS on every table, email OTP sign-in (6-digit codes, never magic links), the service
  role for every write. Signed-in users can read a few of their own rows and write nothing directly; askers can't read
  `asks` at all (the serializer is the only path).
- **Anthropic**: `claude-haiku-5-5` for gates (structured output, thinking off, effort low, rubric cached ahead of the
  member's rules, the ask quoted as data), `claude-sonnet-5-5` for the 5-part compiler, `claude-opus-5-5` offline only.
- **Resend** for email (idempotency keys, scheduled check-ins), **Vercel Cron** daily as a backstop.
- **mcp-handler 2.x** (stateless Streamable HTTP) serves `/mcp`; a Claude Code plugin adds the `/ask` skill and a
  SessionStart hook.

## Layout

```
app/
  layout.tsx            html, fonts (next/font: Outfit + Source Serif 4 roman 500), tokens.css, skip link, footer, live region, ⌘↵
  (site)/layout.tsx     full header (client island) + banner + <main id="main">
    page.tsx            S1 playground (/)
    ask/, ask/[id]/     S2 compose and status
    join/, me/          S3
    agents/             S6
    board/, how/, privacy/   S7
    kit/                F: every kit component (QA only)
  (slim)/layout.tsx     noindex, no-referrer; pages render <SlimPage meta> (slim header + banner + main)
    o/[token]/          R offer page (no JS needed; server actions)
    c/[token]/          R check-in page
    pause/[token]/      S3 pause from an email
    emails/[kind]/      R public SAMPLE email viewer
  api/                  try, compile, health (BE1) · asks/**, cron/**, pause (BE2) · hook (S6)
  mcp/route.ts          S6 MCP server
components/kit          the prototype's kit.html as React components (F)
components/site         header, slim header, footer, banner, live region, ⌘↵ (F)
lib/types.ts            the domain model and every wire shape
lib/oti/*               clause finder, cap rule, time and checkpoints, text helpers, ids, tokens, storage, shared copy
lib/sample/*            SAMPLE data (typed port of the prototype's data.js)
lib/recorded.ts         recorded-run files and their honesty labels
lib/sse.ts              SSE encoder (server) and parser (client)
lib/supabase/*          browser, server (cookies), admin (service role) clients; hand-written Database types
lib/server/*            server-only modules, one owner each (gates, network, members, board)
lib/emails/*            email templates (pure functions)
supabase/migrations     0001_init.sql (F), 0002+ (BE2)
data/recorded           presets.json, sample-network.json ({source: model|authored, …})
```

## The three flows

**1. A reviewer tries their own rules (S1 → BE1).** The landing page is static. “Run” on an unedited preset renders
the recorded run embedded in the page (no request). Any edit runs live: `POST /api/try` streams `plan`, then one
`gate` per ask as each model call returns, then `done`. Every gate's quotes go through `findClause` on the server;
the browser marks the member's own words at the offsets the server found (the read view). The cap is a pure
function (`applyCap`) the browser can re-apply without a model call. Nothing is stored.

**2. A founder asks (S2 → BE1 compiler → BE2 fan-out).** `POST /api/compile` streams the 5 parts (found /
suggested / missing; facts are never invented). REAL: `POST /api/asks` persists the ask, then
`POST /api/asks/[id]/send` runs `prefilter_members` (SQL drops self, paused, at-cap and repeat pairs), fans out to
the remaining gates (≤ 16 in flight, each decision persisted before it streams), and offers the ask to the best
accept through `create_offer`, which calls `reserve_slot` under a row lock in the same transaction: two asks can't
take a member's last slot. The fan-out runs detached from the request (`detachedEvents` + `after()`), so it finishes
and persists even if the asker closes the tab. The stream the asker sees is serialized (4 states). SAMPLE: `POST /api/asks/sample` does
the same over 39 fictional members (recorded) plus the visitor's own gate (live), persisting nothing.

**3. A member decides (BE2 email → R page → BE2).** The offer email's buttons are links; `/o/[token]` renders the card
(the problem, the need, the matched rule in the member's own words, the cap usage) and only a POST from that page
acts: OK (intro email to both), Answer in 2 lines (without the member's name), or No (private; the next accept gets
it). A pass or 72 silent hours moves the offer on; the asker learns of it only at the next 09:00/21:00 checkpoint and
can't tell a pass from an expiry. Check-ins at +1 and +14 days turn intros into outcome labels the board counts.

## Decisions worth knowing

- **One clause finder** (`lib/oti/clause.ts`) for the server check and the read view: NFKC, straight quotes,
  collapsed whitespace, case-folded, one contiguous span, offsets into the original text.
- **Fail closed.** A failed gate is “not checked”, never an accept; more than 1 in 5 failures offers nothing.
- **Privacy in one place.** The asker serializer is the only path from internal state to an asker.
- **Honest data.** Recorded files carry their source; authored data is labelled as written by hand; example numbers
  render only in QA. Without keys, every feature shows its own “not configured” state.
- **Board counts from `audit`**, an append-only table whose member ids are nulled on delete, so “Board counts stay,
  without your name” holds.
- **Tokens**: 128-bit random, only the HMAC (with a per-purpose prefix) is stored; GET never consumes a token.
- **Static shell, client islands.** The shared layouts never read cookies; the header's “Sign in / Your gate” and the
  banner are client islands, so `/`, `/how`, `/privacy` and `/agents` stay static.
- **No-JS token pages** use server actions with `redirect()` (303) and idempotency keys; /pause posts a plain form to
  `/api/pause`, the same handler as one-click unsubscribe.
- **One way to make an offer**: `create_offer` (cap check, one holder per ask, ask still open, member active), so the
  cap holds under concurrency and a lazy “move on” can't race itself.
- **Honest labels by source**: `live`, `recorded` (a model recording) or `authored` (hand-written); the playground's
  cap step says “(code)” because it runs in the browser, and only real offers say Postgres.
