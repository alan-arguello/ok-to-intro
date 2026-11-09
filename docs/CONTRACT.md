# OK to Intro · build contract

Foundation (F) wrote this on Mon 2026-11-09 for the eight builders who work in parallel next. It is binding:
signatures, routes, shapes, file ownership and the honesty rules below do not change during the build. If
something here is wrong or missing, write it in `docs/requests/<owner-id>.md` (see §h) and keep going with the
contract as written.

Sources of truth, in order: `ux-spec.md` v3 (every screen, state, string) → this file (how the pieces fit) →
`spec-ok-to-intro.md` (product) → `build-inputs/tech.md` (verified platform facts). The prototype in
`yc-demo-concept/prototype/` is the visual and behavioral reference; port it, don't redesign it.

Owner ids: **F** foundation · **BE1** gates · **BE2** network · **S1** playground · **S2** ask · **S3** member ·
**R** recipient · **S6** agents · **S7** site.

---

## 0. The shared dev server and the commands

- URL: **http://127.0.0.1:3200** (also `http://localhost:3200`). One server for everyone; never start another.
- It runs in the Terminal tab “ok-to-intro dev 3200”. If it is down, restart it with exactly:

  ```
  cd /Users/alanarguello/Downloads/ok-to-intro && NEXT_DIST_DIR=.next-dev npx next dev -p 3200
  ```

  (same as `npm run dev`). Without a terminal tab: `cd /Users/alanarguello/Downloads/ok-to-intro && nohup env NEXT_DIST_DIR=.next-dev npx next dev -p 3200 > .dev-server.log 2>&1 & disown`.
  Only restart it if it is not answering (`curl -sf http://127.0.0.1:3200/api/health`). Ports 8765 and 8766
  belong to the user's session: never touch them.
- `npm run check` = `typecheck` + `lint` + `test` (vitest). Run it before you report done.
- `npm run build:check` = a production build into its own `.next-build-<pid>` dir, then it restores
  `next-env.d.ts`/`tsconfig.json` and deletes the output. Never run a bare `next build` in this tree (it rewrites
  `next-env.d.ts` to point at its dist dir and breaks `typecheck` for everyone once that dir is gone).
- `npm run recordings:authored` regenerates `data/recorded/*.json` from `lib/sample` (refuses to overwrite a
  `"source": "model"` file without `--force`).
- Audits: `node scripts/shoot.mjs --url http://127.0.0.1:3200/<path> --width 1280 --height 900 --audit` and again
  at `--width 375 --height 812`. Screenshots go to `.shots/<owner-id>/` (gitignored). One headless Chrome at a
  time per agent.
- The machine has no secrets: every feature must build, test and run without them (§e, §14).

---

## a. File ownership

Owners edit only their own paths. Everything F owns is **frozen** during the build. Placeholders that F created in
an owner's path (pages that say “This page is being built.”, `scripts/*` that exit 1, and the stub bodies in §b)
belong to that owner, who replaces them.

| Owner | Paths |
|---|---|
| **F** (frozen) | `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `vercel.json`, `.gitignore`, `.env.example`, `LICENSE`, `proxy.ts`, `types/**`, `app/layout.tsx`, `app/globals.css`, `app/tokens.css`, `app/(site)/layout.tsx`, `app/(slim)/layout.tsx`, `app/(site)/kit/**`, `components/kit/**`, `components/site/**`, `lib/{site,env,types,sse,qa,recorded}.ts`, `lib/sample/**`, `lib/oti/**`, `lib/supabase/**`, `supabase/migrations/0001_init.sql`, `tests/db/harness.ts`, `tests/db/schema.test.ts`, `tests/sample/**`, `tests/foundation/**`, `tests/stubs/**`, `styles/kit.css`, `scripts/build-authored-recordings.ts`, `scripts/build-check.mjs`, `docs/**` (except `docs/requests/<owner>.md`, which each owner writes) |
| **BE1** gates | `lib/server/{gate,rubric,compiler,health,budget,ratelimit,live}.ts`, `app/api/{try,compile,health}/route.ts`, `scripts/{record-presets,eval,bench-gates,draft-eval-candidates}.ts`, `data/recorded/**` (F generated the authored files), `data/eval/**`, `tests/gates/**` |
| **BE2** network | `lib/server/{asks,dispatch,offers,questions,intros,checkins,serializer,checkpoints,email-send,cron,audit}.ts`, `app/api/asks/**`, `app/api/cron/**`, `app/api/pause/route.ts`, `supabase/migrations/0002_*.sql` and later (new files only), `scripts/race-test.ts`, `tests/network/**` |
| **S1** playground | `app/(site)/page.tsx`, `components/playground/**`, `styles/playground.css`, `tests/playground/**` |
| **S2** ask | `app/(site)/ask/**`, `components/ask/**`, `styles/ask.css`, `tests/ask/**` |
| **S3** member | `app/(site)/join/**`, `app/(site)/me/**` (incl. `me/export/route.ts`), `app/(slim)/pause/**`, `components/member/**`, `lib/server/{member,api-tokens}.ts`, `styles/member.css`, `tests/member/**` |
| **R** recipient | `app/(slim)/o/**`, `app/(slim)/c/**`, `app/(slim)/emails/**` (the public SAMPLE email viewer), `components/{offer,checkin}/**`, `lib/emails/**`, `styles/offer.css` (offer and check-in), `tests/recipient/**` |
| **S6** agents | `app/(site)/agents/**`, `app/mcp/route.ts` (serves `/mcp`), `app/api/hook/route.ts` (the SessionStart hook endpoint), `lib/mcp/**`, `lib/receipts.ts`, `components/agents/**`, `.claude-plugin/**`, `plugins/ok-to-intro/**`, `styles/agents.css`, `tests/agents/**` |
| **S7** site | `app/(site)/{board,how,privacy}/**`, `app/not-found.tsx`, `app/error.tsx`, `app/global-error.tsx`, `app/opengraph-image.*` (F copied the prototype's `og.png` there), `app/icon.*` (F copied `favicon.svg` as `app/icon.svg`), `app/robots.ts`, `app/sitemap.ts`, `components/{board,static}/**`, `lib/server/board.ts`, `styles/{board,static}.css`, `scripts/{smoke,check-links,audit-sweep}.mjs`, `scripts/shoot.mjs` (a verbatim copy of the tool; F copied it), `tests/site/**` |
| Integrator (after the build) | `README.md` (F wrote the skeleton), merging `docs/requests/*` |

New files are fine inside your own directories (`components/<yours>/**`, `tests/<yours>/**`, your `app/**`
segments). A new top-level path that isn't listed here needs a request.

---

## b. Cross-owner functions

Each function below exists now as a stub in its owner's file, with this exact signature and JSDoc. The stub
returns a designed “not configured” result, never a verdict or an invented number. The owner replaces the body
and must not change the signature or the result shapes. Callers code against these shapes today. Shared types
are in `lib/types.ts` unless a file is named.

### BE1 (`lib/server/gate.ts`, `compiler.ts`, `health.ts`, `live.ts`, `ratelimit.ts`)

| Function | Signature | Called by | Stub returns |
|---|---|---|---|
| `runGate` | `(input: GateInput, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<GateResult>` | BE2 dispatch (fan-out and the one rerun), BE1 `startTry` | `{ok:false, kind:'unavailable', ms:0}` |
| `startTry` | `(input: TryRequest, context: { clientKey: string \| null; signal?: AbortSignal }) => Promise<TryStart>` | BE1 `/api/try`, S6 `try_rules` | `{ok:false, status:503, body:{error:'live_unavailable', live:'off', until:null}}` |
| `warmGate` | `() => Promise<{ ok: boolean; ms: number; kind?: GateFailureKind }>` | BE2 `/api/cron/warm` | `{ok:false, ms:0, kind:'unavailable'}` |
| `startCompile` | `(input: CompileRequest, context: { clientKey: string \| null; signal?: AbortSignal }) => Promise<CompileStart>` | BE1 `/api/compile`, S6 `draft_ask` | 503 `live_unavailable` (live `off`) |
| `getHealth` | `() => Promise<HealthSnapshot>` | BE1 `/api/health` (the banner reads it) | config-derived snapshot (`live:'off'` without a key) |
| `getLiveState` | `() => Promise<LiveSnapshot>` · `LiveSnapshot = { state: LiveState; paused_until: string \| null }` | BE1, BE2 (refuse a REAL send early), S6 | `{state: hasAnthropic ? 'ok' : 'off', paused_until:null}` |
| `canRunLive` | `(snapshot: LiveSnapshot) => boolean` | same | real (ok or slow) |
| `clientKey` | `(request: Request) => string \| null` | BE1, BE2, S6 routes | `null` |
| `checkRateLimit` | `(key: string \| null, bucket: RateBucket) => Promise<RateLimitResult>` | BE1, BE2, S6 | always allowed |
| `RATE_LIMITS` | `Record<RateBucket, { limit: number; window_s: number }>` (20 per 10 min on try/compile/send/sample_send) | all of the above | real constant |

Shapes (in `gate.ts`): `GateInput = { rules: string; ask: { text; subject?; parts?: AskParts; asker_stage? }; answers?: { type: QuestionType; text }[] }`;
`GateResult = { ok: true; decision: GateDecision; ms; model; request_id: string | null; cost_usd: number | null; usage: GateUsage | null } | { ok: false; kind: GateFailureKind; ms; retry_after_s?; request_id?; decision? }`
(`decision` only for `refused`/`parse`: the decline by code that replaces the missing verdict);
`TryRefusal = { error:'invalid_rules', message } | { error:'rate_limited', retry_at } | { error:'live_unavailable', live: LiveState, until: string | null }`;
`TryStart = { ok: true; events: AsyncIterable<TryEvent> } | { ok: false; status: 400 | 429 | 503; body: TryRefusal }`.
`compiler.ts`: `CompileRefusal` (same three, with `invalid_text`), `CompileStart` (events: `AsyncIterable<CompileEvent>`).

Gate rules every caller can rely on: a quote not found in the member's rules turns the verdict into `decline` with
`decided_by: 'clause_check'` and `model_verdict` keeping what the model said; an ask_back question outside the 8
types, over 100 characters, or containing a URL, path or email becomes a decline; a timeout, rate limit, overload or
budget stop is `{ok:false}` (shown as NOT CHECKED, never an accept); a refusal or unparseable output is a decline by
code (`kind: 'refused' | 'parse'` with `decision`). Cited offsets index the exact rules text passed in.

### BE2 (`lib/server/asks.ts`, `dispatch.ts`, `offers.ts`, `questions.ts`, `checkins.ts`, `audit.ts`)

| Function | Signature | Called by | Stub returns |
|---|---|---|---|
| `recordAudit` | `(action: AuditAction, input?: AuditInput) => Promise<void>` (`AuditInput = { actor_id?, member_id?, asker_id?, ask_id?, offer_id?, detail?: Record<string, string \| number \| boolean \| null> }`) | BE1, BE2, S3 | no-op |
| `canAskReal` | `(user: MemberRef) => Promise<RealAskAccess>` · `{ allowed: true } \| { allowed: false; reason: 'not_configured' \| 'not_invited' \| 'db_down' }` | S2 `/ask` (server), S6 `send_ask` | `{allowed:false, reason:'not_configured'}` |
| `createAsk` | `(user: MemberRef, input: CreateAskInput) => Promise<CreateAskResult>` | BE2 `POST /api/asks`, S6 `send_ask` | `{ok:false, reason:'not_configured', message}` |
| `listMyAsks` | `(user: MemberRef) => Promise<ListResult<AskListItem>>` | S3 `/me`, S6 `my_asks` | `{ok:false, reason:'not_configured'}` |
| `getAskerView` | `(askId: string, user: MemberRef, now?: Date) => Promise<AskerViewResult>` | S2 `/ask/[id]` (REAL), BE2 route, S6 | `{ok:false, reason:'not_configured'}` |
| `startSend` | `(askId: string, user: MemberRef, context: { clientKey: string \| null; signal?: AbortSignal }) => Promise<FanoutStart>` | BE2 `/api/asks/[id]/send`, S6 `send_ask` | 503 `not_configured` |
| `startSampleSend` | `(input: SampleSendInput, context: { clientKey: string \| null; signal?: AbortSignal }) => Promise<FanoutStart>` | BE2 `/api/asks/sample`, S6 `send_ask` (no token) | 503 `not_configured` |
| `getOffer` | `(ref: OfferRef, now?: Date) => Promise<OfferLookup>` · `OfferRef = { token: string } \| { offer_id: string; member_id: string }` | R `/o/[token]` | `{found:false, reason:'not_configured'}` |
| `respondToOffer` | `(ref: OfferRef, action: OfferAction, payload: { answer?: string; idempotency_key: string }, now?: Date) => Promise<OfferActionResult>` | R (server actions), S6 `respond` | `{ok:false, reason:'not_configured'}` |
| `setNoReason` | `(ref: OfferRef, reason: NoReason, note: string \| null) => Promise<{ ok: true } \| { ok: false; reason: 'invalid' \| 'bad_input' \| 'not_configured' \| 'db_down' }>` | R | not_configured |
| `memberForOffer` | `(ref: OfferRef) => Promise<{ member_id: string } \| null>` (server only; never send the id to a browser) | R (No-reason actions call S3) | `null` |
| `listPendingForMember` | `(memberId: string, now?: Date) => Promise<{ ok: true; pending: PendingForMember } \| { ok: false; reason: 'not_configured' \| 'db_down' }>` | S3 `/me`, S6 `pending_for_me` and the hook | not_configured |
| `answerQuestion` | `(input: { ask_id; question_id; answer; user: MemberRef; idempotency_key }) => Promise<AnswerQuestionResult>` | BE2 route, S6 `answer_question` | not_configured |
| `getCheckin` | `(ref: CheckinRef, now?: Date) => Promise<CheckinLookup>` · `CheckinRef = { token } \| { checkin_id; member_id }` | R `/c/[token]` | not_configured |
| `saveCheckin` | `(ref: CheckinRef, answer: CheckinAnswer, idempotencyKey: string, now?: Date) => Promise<CheckinSaveResult>` | R, S6 `record_outcome` | not_configured |

Shapes: `CreateAskInput = { text; compiled: CompiledAsk; idempotency_key }`;
`CreateAskResult = { ok: true; id; status: 'ready' | 'queued'; repeated: boolean; created_at } | { ok: false; reason: 'not_configured' | 'not_allowed' | 'invalid' | 'db_down'; message }`;
`ListResult<T> = { ok: true; items: T[] } | { ok: false; reason: 'not_configured' | 'db_down' }`;
`AskerViewResult = { ok: true; view: AskerAskView } | { ok: false; reason: 'not_found' | 'not_configured' | 'db_down' }` (`not_found` also for someone else's ask);
`SampleSendInput = { sample_ask_id: SampleNetworkAskId | null; text; compiled: CompiledAsk; you: { rules; cap } | null }`;
`FanoutRefusal = { error: 'invalid' | 'not_configured' | 'not_allowed' | 'not_found' | 'queued' | 'already_sent' | 'rate_limited' | 'live_unavailable'; message; retry_at?; live?; ask_id? }`;
`FanoutStart = { ok: true; ask_id; events: AsyncIterable<FanoutEvent> } | { ok: false; status: 400 | 403 | 404 | 409 | 429 | 503; body: FanoutRefusal }`;
`PendingForMember = { offers: PendingOffer[]; questions: PendingQuestion[]; checkins: PendingCheckin[]; cap: { cap; used; month } }` (all in `offers.ts`);
`AnswerQuestionResult = { ok: true; question: AskerQuestion; reran; accepted; repeated } | { ok: false; reason: 'not_found' | 'already_answered' | 'bad_input' | 'not_configured' | 'db_down' | 'live_unavailable' }`.

`/o/[token]` and `/c/[token]` take either the 22-character link token from an email or an object id (`o_…`,
`c_…`) for the signed-in member it belongs to (the /me “Review the ask” link): R resolves the param with
`looksLikeToken()` (lib/oti/ids) → `{ token }`, else `requireMember()` → `{ offer_id, member_id }`.
`sample` is the public SAMPLE token (`SAMPLE_TOKEN`): no database, data from `lib/sample` and browser storage.

### S3 (`lib/server/member.ts`, `api-tokens.ts`)

| Function | Signature | Called by | Stub returns |
|---|---|---|---|
| `getMemberProfile` | `(memberId: string) => Promise<MemberResult>` · `{ ok: true; member: MemberProfile \| null } \| { ok: false; reason: 'not_configured' \| 'db_down' }` (`null` = signed in, not joined yet) | S2 (REAL “Sent as”), S6 | not_configured |
| `saveRules` | `(memberId: string, text: string, source: RulesSource) => Promise<SaveResult<{ version: number }>>` | S3, S6 `set_rules` | not_configured |
| `appendRuleLine` | `(memberId: string, line: string, source?: RulesSource) => Promise<SaveResult<{ version: number }>>` | R (“Add to my rules”) | not_configured |
| `setCap` | `(memberId: string, cap: number) => Promise<SaveResult>` | R (“Lower my cap to 1”) | not_configured |
| `pauseMember` | `(memberId: string, until: string \| null, options?: { stopEmails?: boolean }) => Promise<SaveResult<{ paused_until: string \| null }>>` | R (“Pause until Dec 1”), S3 | not_configured |
| `resumeMember` | `(memberId: string) => Promise<SaveResult>` | S3 | not_configured |
| `pauseByToken` | `(token: string, until: string \| null, options?: { stopEmails?: boolean }) => Promise<SaveResult<{ paused_until: string \| null }>>` | BE2 `/api/pause`, S3 `/pause/[token]` | not_configured |
| `createPauseLink` | `(memberId: string) => Promise<string \| null>` (absolute `/pause/<token>`) | BE2 (email footers) | `null` |
| `verifyApiToken` | `(authorization: string \| null, usedFrom?: 'claude_code' \| 'hook') => Promise<MemberRef \| null>` | S6 (`/mcp`, `/api/hook`) | `null` |

`SaveResult<T> = ({ ok: true } & T) | { ok: false; reason: 'not_configured' | 'db_down' | 'bad_input' | 'not_found' | 'invalid'; message? }`;
`RulesSource = 'web' | 'playground' | 'offer_edit' | 'mcp'`.

### S7 (`lib/server/board.ts`)

| Function | Signature | Called by | Stub returns |
|---|---|---|---|
| `getRealLine` | `() => Promise<RealLine \| null>` | S1 (the dated REAL line, ISR 3600) | `null` → S1 shows `REAL_LINE_OFF` |

### R (`lib/emails/index.ts`; R may split it, but these exports stay)

| Function | Signature | Called by |
|---|---|---|
| `offerEmail` | `(input: OfferEmailInput) => EmailMessage` | BE2 |
| `introEmail` | `(input: IntroEmailInput) => EmailMessage` | BE2 |
| `checkinEmail` | `(input: CheckinEmailInput) => EmailMessage` | BE2 |
| `questionEmail` | `(input: QuestionEmailInput) => EmailMessage` (ux-spec “Later”; build only if time allows) | BE2 |
| `outcomeNoteEmail` | `(input: OutcomeNoteEmailInput) => EmailMessage` (Should) | BE2 |

The stubs return plain text-only messages; R replaces them with the designed templates of `prototype/emails/*.html`
(plain text first, 560 px tables, inline CSS, system fonts, ≤ 20 KB, light only, no images or tracking, buttons ≥ 48 px,
OK in ink with a white label). The offer email sets `List-Unsubscribe: <unsubscribe_post_url>` and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`.

### F (implemented; frozen)

- `lib/supabase/server.ts`: `getServerClient(): Promise<ServerClientResult>`, `getUser(): Promise<UserResult>`
  (`{ ok: true; user: MemberRef } | { ok: false; reason: 'not_configured' | 'signed_out' | 'error' }`),
  `requireMember(options?: { next?: string }): Promise<MemberRef>` (redirects to `/join?next=…`).
- `lib/supabase/admin.ts`: `getAdminClient(): AdminClientResult` (service role, typed with `Database`), `isDbDown(error)`.
- `lib/supabase/browser.ts`: `getBrowserClient(): BrowserClientResult` (only on pages that need it: /join).
- `lib/supabase/cookie-hint.ts`: `hasSessionCookie(cookieString)`.
- `lib/supabase/database.types.ts`: `Database` and row types for every table in 0001.
- `lib/sse.ts`: `sseResponse(request, run, options?)`, `sseFromIterable(request, (signal) => events)`,
  `encodeSseEvent`, `createSseParser`, `readSse(response, onEvent, signal?)`, `postSse(url, body, onEvent, options?)`
  → `PostSseResult` (`{ok:true, completed}` · `{ok:false, status, body}` for 4xx/5xx JSON · `offline` · `aborted`).
- `lib/qa.ts`: `QA_STATES`, `qaEnabled()`, `resolveQaState(page, raw, enabled)`, `qaState(page, raw)`, `resolveDegraded`.
- `lib/recorded.ts`: `PRESET_RECORDINGS` (embedded), `loadSampleNetworkRecordings()` and
  `sampleNetworkRun(id)` (async: a separate chunk), `presetRun`, `recordedGateEvent`, `recordedLabel`,
  `recordedDateLabel`, `isAuthored`, `validateRecordedFile`.
- `lib/oti/clause.ts`: `norm`, `findClause`, `checkQuotes`, `allFound`, `ownWords`, `markedSegments`,
  `readViewLines`, `ruleLines`, `lineOf` (the one clause finder, server and client).
- `lib/oti/cap.ts`: `applyCap(rows, cap, provisional?)`, `DISPLAY_LABEL`, `capLine`, `capUsedLabel`, `CAP_CHOICES`.
- `lib/oti/time.ts`: `fmtWhen/fmtDay/fmtWeekday/fmtWeekdayShort/fmtClock(ms, tz?)`, `hoursLeft`, `lastCheckpoint`,
  `nextCheckpoint`, `askerAsOf`, `capMonth`, `monthName`, `resetsOn`, `nextMonthStart`, `NETWORK_TZ`, `OFFER_WINDOW_MS`.
- `lib/oti/text.ts`: `needsLine`, `bareSubject`, `fmtMs`, `fmtUsd`, `fmtN`, `plural`, `q`, `joinAnd`, `traceTime`,
  `shuffled`, `hash32`, `hex4`, limits (`RULES_MAX` 1000, `ASK_TEXT_MAX` 600, `ANSWER_MAX` 280, `SUBJECT_MAX` 45).
- `lib/oti/ids.ts`: `publicId(kind)`, `newToken()`, `looksLikeToken()`, `SAMPLE_TOKEN`; `lib/oti/tokens.ts` (server):
  `hashToken(purpose, token)` (HMAC, null without `TOKEN_HMAC_SECRET`), `sameDigest`, `rateKey(ip, day)`.
- `lib/oti/storage.ts`: `readStore/writeStore/clearStore` and the four shapes (§storage below).
- `lib/oti/copy.ts`: strings two or more owners print (banner copy, failure rows, privacy lines, labels).

---

## c. API routes

All JSON errors are `{ error: <code>, message?: <copy>, …}` with `Cache-Control: no-store`. Streams are
`text/event-stream; charset=utf-8` with `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, an
`id: n` on every event and a `: ping` every 10 s (use `lib/sse.ts`; never wrap a stream in a JSON helper, never
await all gates before returning). Streaming handlers export `runtime = 'nodejs'` and `maxDuration` (30 try and
compile, 60 send and /mcp). Clients read POST streams with `postSse` and must render the right final state even if
every event arrives in one chunk.

| Route | Owner | Request | Response |
|---|---|---|---|
| `POST /api/try` | BE1 | `TryRequest {rules, ask_ids?}` | 400 `invalid_rules` · 429 `{error:'rate_limited', retry_at}` · 503 `{error:'live_unavailable', live, until}` · SSE `TryEvent`: `plan` → (`gate` \| `error`) × n → `done` |
| `POST /api/compile` | BE1 | `CompileRequest {text, network}` | 400 `invalid_text` · 429 · 503 · SSE `CompileEvent`: `plan` → `part` × 5 → `done`, or `refused`, or `error` |
| `GET /api/health` | BE1 | — | `HealthSnapshot` (`s-maxage=15`) |
| `POST /api/asks` | BE2 | `CreateAskInput` (signed in) | 201/200 `CreateAskResult` · 400 · 401 `signed_out` · 403 `not_allowed` · 503 |
| `POST /api/asks/sample` | BE2 | `SampleSendInput` | 400 · 429 · 503 `FanoutRefusal` · SSE `FanoutEvent` with `FanoutCellEventSample` cells |
| `GET /api/asks/[id]` | BE2 | owner only | `AskerAskView` · 401 · 404 · 503; with `Accept: text/event-stream` (EventSource + `Last-Event-ID`) a tail of new events |
| `POST /api/asks/[id]/send` | BE2 | — (owner) | 401 · 403 · 404 · 409 (`queued`, `already_sent`) · 429 · 503 · SSE `FanoutEvent` (REAL cells: 4 states only) |
| `POST /api/asks/[id]/answer` | BE2 | `{question_id, answer, idempotency_key}` | `AnswerQuestionResult` · 400 · 401 · 404 · 409 · 503 |
| `POST /api/asks/[id]/withdraw` | BE2 | `{idempotency_key}` | `{ok:true, withdrawn_at}` · 401 · 404 · 409 · 503 |
| `POST /api/asks/[id]/resolve` | BE2 | `{solved: boolean, idempotency_key}` | `{ok:true, outcome}` · 401 · 404 · 409 · 503 |
| `GET /api/cron/daily`, `GET /api/cron/warm` | BE2 | `Authorization: Bearer CRON_SECRET` | 200 · 401 · 503 when CRON_SECRET is unset (`vercel.json` schedules both daily) |
| `POST /api/pause?token=` | BE2 | one-click body `List-Unsubscribe=One-Click`, or the /pause form `{token, until: '2w' \| 'month' \| 'off'}` | one-click: 200 text; form: 303 → `/pause/<token>?done=1` (or `?error=<reason>`) |
| `GET/POST/DELETE /mcp` | S6 | Streamable HTTP (mcp-handler 2.x, stateless); `Authorization: Bearer <token>` optional | `try_rules`, `draft_ask` open; `send_ask` open on SAMPLE only; the rest need a token |
| `GET /api/hook` | S6 | `Authorization: Bearer <token>` | 200 JSON `{systemMessage, hookSpecificOutput}` when something waits; 204 otherwise (the hook prints nothing) |
| `GET /me/export` | S3 | signed in | JSON download of the member's own data |
| Server actions | R, S3 | `<form action={…}>` | see §forms |

### Event shapes (ux-spec §8; `lib/types.ts` is the code)

```
try      plan  {run_id, mode: 'live'|'recorded', rules_chars, gates: [{i, ask_id}], recorded_at?}
         gate  {i, ask_id, verdict, model_verdict*, cited: [{text, found, start?, end?}], decided_by: 'gate'|'clause_check',
                reason_code, reason, question: {type, text}|null, flags: [], confidence: number|null, ms: number|null, source}
         error {i?, ask_id?*, kind: 'timeout'|'rate_limited'|'overloaded'|'refused'|'budget'|'parse', retry_after_s?}
         done  {counts: {accept, decline, ask_back, failed}, wall_ms, cost_usd: number|null}
compile  plan {draft_id, words, network} · part {i, part: CompiledPart} · refused {kind: 'vague'|'yc_application', message}
         · error {kind, retry_after_s?} · done {draft_id, subject, topic*, parts, ms}
fan-out  plan {ask_id, network, total, sample_source?, recorded_at?} · cell {cell, state} · question {qid, type, text, gates}
         · offer {expires_at, to?: 'you'|'member' (SAMPLE only)} · error {kind, message}
         · done {wall_ms, people_interrupted, counts: {offered, next, question, nothistime}, gates_ran, gates_failed, failed_closed}
```
`*` = additions to the spec's shape: `model_verdict` (the copy “code changed accept to decline” needs it), `ask_id` on
row errors, `topic` on compile `done` (for the board's unanswered demand). Counting: `done.counts.decline` includes
clause-check and refused/parse declines; `failed` counts rows NOT CHECKED (timeout, rate_limited, overloaded, budget).
Row rendering for errors: `refused`/`parse` → DECLINED BY CODE with `GATE_FAILURE_COPY[kind]`; the others →
NOT CHECKED with `GATE_FAILURE_COPY[kind]` and (Retry). `applyCap` (lib/oti/cap.ts) does exactly this.

REAL `cell.state` is only `offered | next | question | nothistime`. SAMPLE cells carry the full internal result
(`FanoutCellEventSample`), shown only behind “Show what askers never see (SAMPLE only)”.

---

## d. The asker serializer (BE2 `lib/server/serializer.ts`)

Everything an asker can read about a REAL ask goes through one pure function,
`serializeForAsker(snapshot, now): AskerAskView` (BE2-internal; snapshot-tested with fixtures that contain every
forbidden field). The REAL fan-out stream, `GET /api/asks/[id]`, `getAskerView`, `listMyAsks`, MCP receipts and
the hook all use its output.

1. **Four states only.** Per member: `offered` (holds the offer, or said OK), `next` (accepted, in line),
   `question` (their gate's question is pending), `nothistime` (everything else: declined, SQL-skipped at cap /
   paused / repeat pair / self, failed, passed, expired, withdrawn).
2. **Never emitted:** caps, usage, pauses, at-cap counts, member ids or labels, any decliner, per-member reasons,
   latencies, confidences, rules text, or which member asked a question. A member's verbatim matched line only when
   that member turned “Show askers the line that matched” on (`matched_line`); otherwise “Matched a member's rules.”
   Identity (name, one line, scheduling link) only after OK (`intro`).
3. **Reasons need 3 gates.** Coarse reasons (`no_match.why`) are counted over the whole network once at least 3
   gates ran; any bucket under 3 folds into `other`, and SQL skips fold into `other`, so capacity can't be inferred.
4. **A pass and an expiry read the same.** Both become `nothistime` for that member and either move the offer on
   (`offered` again, position + 1: “Offered to the next person in line (2 of 3)”) or close the ask
   (`closed.reason: 'all_passed'`). Nothing distinguishes them.
5. **Checkpoints.** Asker-visible changes other than “intro made” land at the next 09:00 or 21:00 in Mexico City,
   computed on read: the view reflects `askerAsOf(ask.gated_at, now)` = max(send finished, last checkpoint)
   (lib/oti/time.ts). Member-driven events (pass, expiry, 2-line answer, the offer moving on) with a timestamp after
   `as_of` are invisible until the next checkpoint. Machine results the asker triggered (the send's fan-out, the
   rerun after their answer) and **intro made** show at once. `as_of` and `next_checkpoint` are in the view.
6. `people_interrupted` counts offers delivered as of `as_of`.
7. The raw trace for REAL is exactly ux-spec S2 “Raw trace for the asker on REAL” (4 lines), nothing else.

SAMPLE is different on purpose: everything is fictional, so the reveal switch may show caps, labels, reasons and
skips, always captioned “On the real network, askers see only: offered, next in line, question for you, not this time.”

---

## e. Honesty labels

1. **Recorded data by its real source.** `data/recorded/*.json` carry `source`. Today both are `"authored"`
   (generated from `lib/sample`, a hand-written literal reading). Use `recordedLabel(file, run)`:
   - `"model"` → “Recorded run · Nov 9, 09:00 · claude-haiku-5-5 · 12 gates in 1.9 s · $0.002”; rows may show their
     recorded latency (“1.3 s · recorded”); S2 replays at recorded ms (“replayed at recorded speed”).
   - `"authored"` → `AUTHORED_LABEL` “Example verdicts, written by hand · not a model run”; latency, cost and
     confidence are `null`, so show none; S2 renders at once (no replay timing) and labels it the same way. Never
     write “Recorded run”, “model”, a `$` figure or a latency next to authored data.
2. **Live means a model call happened.** A row says `live` only for a `gate` event from `/api/try` (or the fan-out
   YOU gate). The build never renders a verdict the model did not return: when live is unavailable, show the
   designed down / budget / limited / off notice and keep the last real result.
3. **No client-derived verdicts presented as model output.** The browser may only (a) re-apply the cap with
   `applyCap` (labelled “Cap changed to 1. Applied in code, no model call.”, and rows that flip say
   “Decided by: cap”), (b) mark the clause-check test row, always labelled “Test of the code check: a fake model
   output, not a model call” (`CLAUSE_CHECK_TEST_OUTPUT`), never inside a live run. The prototype's “simulated
   stand-in” for edited rules does not exist in the build.
4. **SAMPLE vs REAL.** Every sample surface carries `<SampleTag/>`; real data carries `<RealTag/>`. SAMPLE names,
   companies, members and asks are fictional (`lib/sample`). `lib/sample/examples.ts` (board, REAL line, /me numbers)
   renders only in QA states (`isQA`), next to `PROTOTYPE_NUMBERS_NOTE` in a `.proto-note`; production pages read real
   counts or show their designed empty / not-configured state. Today's honest REAL line is `REAL_LINE_OFF`.
5. **Transcripts and receipts on /agents** are SAMPLE: receipts must be produced by `lib/receipts.ts` from SAMPLE
   data; the Claude Code turns around them are illustrative and labelled as an example transcript, not as a recording.
6. **Estimates are estimates.** `COST.perGate` ($0.00016) is an estimate until `npm run bench` measures it
   (`COST.estimate`); copy says “about”. Live runs report cost measured from usage, or nothing.
7. **The eval.** Board eval numbers come only from `npm run eval` output (data/eval, BE1). Until it has run, the
   board shows “No eval run yet”, never the prototype's example table.
8. **Not configured is not an outage.** Without keys, say so (`BANNER_COPY.off`, `REAL_LINE_OFF`, “Sign-in isn't set
   up on this instance”), never “the model API isn't answering”.

---

## f. CSS conventions

- `app/tokens.css` is the prototype's `tokens.css`, unchanged; `app/globals.css` adds only the no-JS bar padding,
  `.mark--trap`, and `main:focus`. Nothing may override a token or a kit rule.
- Each owner ports its page CSS from `a.css`/`b.css` into its own `styles/<owner>.css` and imports it from its own
  pages or components (`import '@/styles/playground.css'`). Class names stay as in the prototype (`pg-`, `ask-`,
  `st-`, `board-`, `how-`, `priv-`, `err-`, `offer-`, `ck-`, `join-`, `me-`, `ag-`), colours only through tokens.
  CSS in Next is global: prefix every new class with your prefix.
- Kit markup comes from `components/kit`; don't hand-copy kit HTML. On the landing page (S1, JS budget ≤ 35 KB
  brotli) import from the component's own file (`@/components/kit/button`) rather than the barrel.
- Layouts render `<main id="main">`; pages render their container inside it (`<div className="container">`,
  `container--col|form|narrow`). Slim pages render `<SlimPage meta={…} mainClassName="container container--narrow offer-main">`.
  `app/not-found.tsx` and `app/error.tsx` sit outside the route groups: they render `<SiteShell>` (header, banner,
  main) from `components/site/site-shell.tsx`; `app/global-error.tsx` renders its own `<html><body>`.
  A prototype rule written as `main.x` becomes `.x` on that container.
- Body classes don't exist in the app: `<Bar>` sets `data-has-bar` and globals.css pads the body (prototype
  `has-bar` / `has-bar-lg`). Page-specific body padding (b.css `me-has-bar`) moves to a class on your container.
- One black pill per view (`variant="primary"`); orange only in the places ux-spec §2.2 lists; nothing dimmed with
  opacity; every `[data-primary]` ≥ 44 px; text never below 4.5:1.

## g. Testing conventions

- vitest (`npm test`), node environment by default; `.test.tsx` files can `renderToStaticMarkup`; add
  `// @vitest-environment jsdom` at the top of a file that needs a DOM (jsdom and @testing-library/react are installed).
- Tests live under `tests/<owner-dir>/` (gates, network, playground, ask, member, recipient, agents, site).
  `server-only` is aliased to a stub, so server modules import in tests.
- Database tests use `tests/db/harness.ts` (`createTestDb()`, `asUser`, `asAnon`, `asService`, `createMember`):
  PGlite with the Supabase roles, `auth.uid()` and every migration applied in order. It proves logic and RLS, not
  concurrency (that's `npm run race` against `DATABASE_URL`).
- Audits: `scripts/shoot.mjs` against the shared dev server at 1280×900 and 375×812, every page and QA state:
  0 console errors, 0 exceptions, scrollWidth = viewport, 0 contrast failures, 0 unlabeled controls. Screenshots go
  to `/Users/alanarguello/Downloads/ok-to-intro/.shots/<owner-id>/`.

## h. Rules

1. No new dependencies; don't edit `package.json` or the lockfile.
2. No edits outside your paths (§a). Requests for shared files go to `docs/requests/<owner-id>.md`: one section per
   request with the file, the exact change, and why. The integrator merges them after the build.
3. No outward actions: no deploys, pushes, emails, paid API calls; never call Supabase, Vercel, Resend or GitHub.
4. No real people's data: only `lib/sample` and Alan's own. No YC branding except the footer line.
5. No `TODO` stubs left in your files; a piece the cut line removes renders its designed state.
6. Copy: curly quotes and apostrophes in UI text (lint enforces `react/no-unescaped-entities`); no exclamation marks,
   “AI-powered”, “seamless” or “magic” (`BANNED_COPY` in lib/oti/text.ts for your tests).
7. Never log request bodies (rules, asks, answers) or tokens.

---

## §forms · No-JS forms and actions (R, S3)

- /o, /c and /pause work without JS: GET renders and never changes anything; every change is a `<form>` POST to a
  **server action**, which runs the change idempotently (key = token + action) and calls `redirect()` → 303 to the
  result (`/o/<token>?done=ok` or similar). Next checks `Origin` against `Host` for server actions (CSRF); keep the
  forms in server components (or client components using `useActionState`, which also degrades to a plain POST).
- Email buttons are links to `/o/<token>?choice=ok|answer|no` and `/c/<token>?v=…`: the GET preselects, only the
  page's own button acts. Never auto-submit with JS.
- `next.config.ts` already sends `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer` and
  `X-Robots-Tag: noindex` for `/o/*`, `/c/*`, `/pause/*`; the (slim) layout sets `robots: noindex`.

## §links · Cross-surface URLs

| From | Link | To |
|---|---|---|
| S1 bridge, all-declined | “Send a sample ask (your gate is 1 of 40) ›”, “Write an ask your rules accept” | `/ask?from=playground` |
| S1 bridge | “See a sample offer as a member would ›” | `/o/sample?from=playground` |
| S1 bridge | “Keep these rules” | `/join` (rules carried in `oti.playground`) |
| S2 status (SAMPLE) | “Open it as the member” | `/o/sample?ask=<sa_id>` |
| S2 intro (SAMPLE) | “See the intro email (sample) ›” | `/emails/intro?ask=<sa_id>` |
| S2 intro (SAMPLE) | “See tomorrow’s check-in (sample) ›” | `/c/sample?ask=<sa_id>&role=member` if the visitor held the offer, else `&role=asker` |
| S2 | “Edit and resend” · “Use this edit” | `/ask?preset=<preset>` · `/ask?preset=<preset>&edit=1` |
| S2 compose (REAL) | “Edit profile ›” · crumbs “‹ Your asks” | `/me#settings` · `/me#asks` |
| R /o (SAMPLE) | “See the intro email ›” · “Back to the playground ›” | `/emails/intro?ask=<id>` · `/` |
| R /o, /c (REAL) | “Your gate ›” · invalid “Sign in” | `/me` · `/join` |
| Footers (emails, /c) | Pause all asks · Change your rules · Delete my data · Your ask | `/pause/<token>` · `/me#settings` · `/me#delete` · `/ask/<id>` |
| S3 /me | “Review the ask” · “Test my rules ›” | `/o/<offer_id>` · `/` (writes `oti.playground`) |
| S3 /join | “Write your rules first ›” · after verify | `/` · `/me?first=1` (or `?next=`) |
| S7 404 / error | (Sign in) (Try the playground) | `/join` · `/` |
| Email viewer | kinds `offer`, `intro`, `checkin-1d`, `checkin-14d`, `question`, `outcome-note`, `code` | `/emails/<kind>?ask=<sa_id or a01…>&who=asker\|member&v=text` |

/me anchors S3 must provide: `#asks`, `#settings`, `#token`, `#delete`.

## §storage · Browser storage (`lib/oti/storage.ts`)

sessionStorage, `v: 1`, never throws. Keys and shapes are the code: `oti.playground` (`PlaygroundStore`, written by
S1 and by S3's “Test my rules”), `oti.sampleAsk` (`SampleAskStore`, S2), `oti.sampleOffer` (`SampleOfferStore`, R),
`oti.join` (`JoinStore`, S3). Readers ignore values they can't parse. Nothing else goes in browser storage except a
surface's own UI conveniences under its own prefixed key (`oti.<owner>.<name>`).

## §qa · QA states and the banner

- `?state=<name>` is honoured only when `qaEnabled()` (development, or `QA_STATES=1`); names are in `QA_STATES`
  (lib/qa.ts) and match the prototype's. Static pages resolve QA state on the client (`resolveQaState(page,
  searchParams.get('state'), qa)` with `qa` passed down from a server component); dynamic pages may use `qaState()`.
- `?degraded=slow|down|budget|limited|offline|off` drives the banner (components/site/banner.tsx, already in both
  layouts and `SlimPage`). A surface whose own controls depend on live calls reads the same value (QA) or
  `/api/health` (`live`) to render its own notice (ux-spec S1/S2/S6 copy).
- `/kit` renders every kit component (QA only).

## §time · Time zones

Client components show the viewer's zone (`fmtWhen(ms)` with no `tz`); server code and emails pass `NETWORK_TZ`
(America/Mexico_City, “CST”). SAMPLE flows stamp their own times (sent = now, reply by = offered + 72 h). Cap months
are calendar months in Mexico City (`capMonth`, SQL `public.cap_month`). Asker checkpoints: §d.5.

## §db · Database (`supabase/migrations/0001_init.sql`)

- Tables: `members` (settings, asker profile, status `pending|on|paused`, `paused_until`), `rule_versions` + `rules`
  (current), `cap_usage`, `real_askers`, `asks`, `ask_members` (who each ask fanned out to: fixed waffle position and
  SQL skip reason), `questions`, `gate_decisions`, `offers` (HMAC'd token, state machine trigger, 72 h window, one
  pending per ask), `intros`, `checkins` (HMAC'd tokens), `api_tokens`, `pause_tokens`, `rate_limits`, `email_outbox`,
  `audit`, `eval_cases`, `eval_runs`, `eval_results`.
- Functions: `cap_month(ts)`, `member_is_active(m, at)`, `save_rules(member, text, source)`,
  `reserve_slot(member, month)` (creates the row, row-locks it, compares with the cap, takes one slot or not),
  `create_offer(id, ask, member, token_hash, position, at)` (lock the ask, refuse a second pending offer,
  `reserve_slot`, insert, all in one transaction), `expire_due_offers(now)`, `prefilter_members(asker, at)`
  (skip reasons `self | paused | at_cap | repeat_pair`), `hit_rate_limit(key, bucket, window_s, limit)`,
  `real_line()`, `board_snapshot()` (every board number with its definition).
- RLS on every table. `anon`: nothing. `authenticated`: select own rows on members, rules, rule_versions, cap_usage,
  asks (as asker), offers (as member), intros (either party), checkins, api_tokens; update own member settings
  columns; execute `save_rules` for themselves. Everything else is server-only (service role). Default privileges are
  revoked, so **0002+ migrations must enable RLS and grant explicitly** on every new table and function.
- `audit` is append-only facts for the board; member ids there become null on delete. Writers: BE1
  `playground_run {gates}`; BE2 `ask_sent {topic}`, `gate_checked {verdict, decided_by, attempt}`, `question_answered`,
  `offer_delivered`, `offer_ok|answered|passed|expired|withdrawn`, `intro_made`, `checkin_answered {kind, role, rating|outcome}`,
  `ask_withdrawn|closed|no_match|failed_closed`, `compile_refused`, `sample_ask_sent`; S3 `member_joined`,
  `member_gate_on`, `member_paused`, `member_resumed`, `member_deleted`, `rules_saved`, `token_created`, `token_revoked`.
  `detail` never holds rules text, ask text, names or emails.

## §14 · Environment and designed states without keys

`lib/env.ts` (server only) parses every variable in `.env.example` and never throws. Flags: `hasAnthropic`,
`hasSupabase`, `hasSupabaseAdmin`, `hasTokenSecret`, `realNetwork`, `hasResend`, `hasCron`, `hasRateLimitSalt`,
`isQA`. Today all are false except `isQA` in development. Expected states with no keys:

| Surface | Without keys |
|---|---|
| Banner | `BANNER_COPY.off` on every page |
| S1 | Presets run from the authored file (labelled `AUTHORED_LABEL`); edits and Run live show the live-off notice; REAL line `REAL_LINE_OFF` |
| S2 | Compose: the compiler-down manual 5-part form; SAMPLE send of a sample ask renders authored results with YOUR gate NOT CHECKED (live off); REAL disabled with its copy |
| S3 | /join: sign-in isn't set up on this instance (no form); /me redirects to /join |
| R | /o/sample and /c/sample work fully from lib/sample; real tokens render `invalid` (“This link doesn’t match an offer…”) |
| S6 | /agents works; `/mcp` try_rules/draft_ask return the live-off isError text; token tools return the sign-in text |
| S7 | /board: “The real network isn’t connected on this instance yet.” with no numbers (QA shows examples with the note) |
