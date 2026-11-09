# Requests from S7 (site: /board, /how, /privacy, 404, error, OG, robots, sitemap, smoke and audit scripts)

S7 built against the contract as written. Each item says what S7 does meanwhile.

## 1. Board counts as of the last checkpoint (privacy)
- File: a new migration `supabase/migrations/0003_board_as_of.sql` (BE2 or the integrator), plus
  `lib/supabase/database.types.ts` (F): `board_snapshot: { Args: { p_as_of?: string }; Returns: Json }`.
- Change: copy `tests/site/fixtures/board-as-of.sql` verbatim. It replaces `board_snapshot()` with
  `board_snapshot(p_as_of timestamptz default now())`: the same numbers, with every audit fact and row filtered to
  `at <= p_as_of` (it drops the zero-argument version, so a call without arguments isn't ambiguous and still means
  “now”). `tests/site/board-sql.test.ts` proves it on PGlite on top of 0001 and 0002: a pass after the checkpoint stays
  out, the shape is what `parseBoardSnapshot` reads, counts survive a delete, only `service_role` may call it.
- Why: /board is public and regenerates every minute. An asker who is the only one with an open ask could watch
  “People interrupted” go up the minute a member passes (the offer moves to the next person), or “Answered in 2 lines”
  move when a member answers, which the asker serializer hides until the next 09:00 / 21:00 checkpoint
  (CONTRACT §d.5, ux-spec decision 7: “the timing of a No can't be inferred”). Counting up to the last checkpoint gives
  the board the same timing askers get. The board's “How this is counted” then says so.
- Meanwhile: `lib/server/board.ts` already calls `board_snapshot(p_as_of => lastCheckpoint(now))`. Until the
  migration ships, PostgREST answers PGRST202, and the board falls back to the current counts (`asOfKind: 'read'`;
  each instance retries `p_as_of` every 10 minutes), labelled with the time they were read. Nothing breaks either way.
- Related (ux-spec §3 “ISR 60 s + revalidatePath on writes”): with checkpoint counts the board needs no revalidation
  on writes; ISR 60 s picks up each checkpoint within a minute, so S7 exports no revalidate hook and BE2 needs no call.
- Also for privacy, already in the board code: the median time to answer an offer is shown only from 3 answered offers
  (with 1 offer it is that member's own answer time).
- Blocking? No.

## 2. Pages that set `metadata.openGraph` lose the OG image (S1 `/`, S3 `/join`)
- Files: `app/(site)/page.tsx` (S1), `app/(site)/join/page.tsx` (S3), and any page that sets `openGraph`.
- Change: add `images: [OG_IMAGE]` to `openGraph` (and `images: [{ url: OG_IMAGE.url, alt: OG_IMAGE_ALT }]` to
  `twitter`), or build the three fields with `shareMetadata({ title, description, path })`; both are exported from
  `components/static/share.ts`.
- Why: Next replaces the root `openGraph` object with the page's, so the file-based `app/opengraph-image.png` is
  dropped. Checked on the dev server: `/` and `/join` render no `og:image` / `twitter:image` today, while `/how`,
  `/privacy`, `/agents` (no own `openGraph`) and `/board` (which lists the image) do. The landing page is the link
  in the email: its preview needs the image.
- Blocking? For the email, yes. Nothing else depends on it.

## 3. `oktointro.app` in lib/site.ts doc comments (F)
- File: `lib/site.ts` (lines 23, 29, 89).
- Change: replace the examples `https://oktointro.app` / `oktointro.app` with `https://ok-to-intro.vercel.app` /
  `ok-to-intro.vercel.app` (Alan's decision in docs/requests/alan.md).
- Why: `npm run check:links` (and `npm run smoke` step 6) fails on the prototype's placeholder domain anywhere in the
  published source, so a stale example can't ship. These three comments are the only hits.
- Blocking? Only the pre-send check.

## 4. RULES_TO_ANTHROPIC wording (F, optional)
- File: `lib/oti/copy.ts`
- Change: “…and Anthropic keeps API data for up to 30 days.” → “…and Anthropic deletes API data within 30 days by
  default.”
- Why: tech.md (verified Nov 8–9): Anthropic deletes API inputs and outputs within 30 days by default; content its
  safety review flags can be kept up to 2 years. /privacy's Processors row says the precise version; the shared line
  under the who-sees-what table (also on /me) reads as a fixed 30-day keep.
- Blocking? No.

## 5. What the board's “quotes not found” counts (agrees with BE1 request 4)
- File: none required.
- `board_snapshot().quotes_not_found` counts every `decided_by = 'clause_check'` (a quote not in the rules, no quote,
  or a broken question), so /board labels it “Verdicts overruled by code” and the clause-check line says what code
  checks, instead of the prototype's “quoted text that isn't in the member's rules; code changed both to declines”.
- If the strict number is wanted later: BE2 adds `quote_missing: true|false` to the `gate_checked` audit detail and the
  snapshot counts it; the board then shows both.

## 6. Hooks the smoke test drives (S1, S2, R: keep them stable)
- `scripts/smoke.mjs` presses the first visible `[data-primary]` on `/` and waits for 12 `.row[id^="pg-row-"]` rows
  whose `.verdict` isn't `--notrun` or `--checking` (S1); on `/ask` it clicks `[data-sample="partial"]`, `#ask-check`,
  every `[data-use]` and `[data-sample-answer]`, then `#ask-send`, and waits for “Offered” in `#st-outcome` on
  `/ask/sa_…` (S2); on `/o/sample` it clicks `[data-key="ok"]`, then `[data-send]`, and waits for “Intro sent” in
  `#offer-done-h` (R). All pass today against the dev server.

## 7. Production pages log “preloaded but not used” for other pages' CSS (F, integrator)
- Files: `components/site/site-header.tsx`, `components/site/site-footer.tsx` (F), or how page CSS is loaded.
- Seen on a production build of HEAD + S7's files (`next start`, Chrome, 3.5 s after load): /how logs
  “The resource …/board-css.css was preloaded using link preload but not used within a few seconds”, /board logs it
  for the /how-and-/privacy CSS, and the 404 page for both. Cause: every visible `<Link>` prefetches its route in
  production, and the prefetched payload preloads that route's stylesheet on the current page. With every builder's
  page CSS in place, each page will log one such warning per linked page that has its own stylesheet. `next dev`
  doesn't prefetch, so dev audits never show it; shoot.mjs reads the console 600 ms after load, so most audits miss it.
- Options: (a) accept it (a performance hint, not an error; `scripts/smoke.mjs` and `scripts/audit-sweep.mjs` already
  ignore exactly this message and nothing else); (b) `prefetch={false}` on the header and footer links (slower
  navigation); (c) one global stylesheet for every page's CSS from the root layout (more CSS on the first load).
- Blocking? No. The boundaries (404, error, global error) import no stylesheet for this reason: theirs would be
  preloaded on every page.

## 8. QA routes S7 added (integrator)
- `/how/error-preview` renders the error page's view without throwing (QA only, 404 in production unless
  `QA_STATES=1`, disallowed in robots.txt), so `npm run audit` covers the error page. The 404 page is swept at
  `/qa-sweep-not-found`; its one console line (“Failed to load resource: … 404”) is the document's own status, and
  besides item 7's preload hint it is the only console line the sweep allows.
- `npm run smoke` step 4 (`?degraded=down`) needs QA: it checks `/kit` first and prints SKIP on a deployment where QA
  is off, instead of failing.
