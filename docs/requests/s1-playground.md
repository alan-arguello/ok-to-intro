# Requests from S1 (playground)

None of these block S1: each section says what S1 does meanwhile.

## RulesReadView needs the read view's attributes
- File: components/kit/clause.tsx
- Change: let `RulesReadView` take `id`, `tabIndex`, `labelledBy`, `describedBy`, `onClick`, `onKeyDown`, and name the mark keys attribute `data-rows` (prototype markup), e.g.
  `<ol class="rules" id="pg-rules-list" tabindex="0" aria-labelledby="pg-rules-lbl" aria-describedby="pg-read-hint">`.
- Why: ux-spec S1 “Read view”: the list is focusable, labelled by “Your rules”, and a click or Enter returns to the textarea.
- Blocking? no. S1 renders the same `ol.rules > li > mark.mark + span.tally` markup itself (components/playground/rail.tsx),
  using `readViewLines` from lib/oti/clause.ts, so the marks still come from the one clause finder.

## Bar needs a className
- File: components/kit/blocks.tsx
- Change: add an optional `className` to `<Bar>` (merged after `bar bar--phone`).
- Why: the prototype's phone bar is `class="bar bar--phone pg-bar"`; a.css styles `.pg-bar .btn`.
- Blocking? no. S1 passes `id="pg-bar"` and styles `#pg-bar .btn` in styles/playground.css.

## Banner for QA states that imply a degraded mode
- File: components/site/banner.tsx (or lib/qa.ts)
- Change: on `/`, map `?state=api-down|budget|offline|rate-limited` to the banner kinds `down|budget|offline|limited`
  (the prototype's `degrade()` showed the banner for those states), or document that audits add `&degraded=`.
- Why: with `?state=api-down` alone the playground shows its own paused copy, but the banner slot stays empty.
- Blocking? no. S1's audit sweep uses `?state=api-down&degraded=down` (and the same for budget, offline, rate-limited).

## One health read per page (optional)
- File: components/site/banner.tsx
- Change: expose the health snapshot the banner already fetches (a tiny client store or hook in components/site), so
  the playground doesn't GET /api/health a second time.
- Why: `/` makes two identical GET /api/health requests after hydration (banner + playground). Harmless (small,
  `s-maxage=15`), but one would do.
- Blocking? no. S1 fetches /api/health itself to know whether live checks can run (Run live, the add-line edit and
  edited rules show the designed notice and stay disabled when live is off/down/budget).

## Board anchor for the quote test (S7)
- File: app/(site)/board/** (S7)
- Change: keep `id="b-clause-title"` on the clause-check section heading, as in prototype/board.html.
- Why: the playground's “Test the quote check” row links to `/board#b-clause-title`
  (“Clause-check counts on the Board ›”).
- Blocking? no (the link still opens /board).

## Copy changes made for honesty (Alan / integrator to confirm)
- Cap help: “Enforced in Postgres after the gate. Changing it needs no model call.” → “Postgres enforces it on real
  offers. Changing it here needs no model call.” (the playground applies the cap in code, contract §e.9).
- Run note with hand-written presets: “Shows the recorded run at once…” → “Shows the example verdicts at once. Run
  live calls the model, about 2 s.”; with live off: “Shows the example verdicts at once. Live checks are off on this
  instance.”; edited rules with live unavailable: “Edited rules need a live check. Live checks are off on this
  instance.” (and the paused / limited / offline variants in components/playground/copy.ts).
- New notice for an instance without a key: “Live checks are off on this instance: no model API key is set. Your
  rules stay in this tab.”
- Decided-by chain for hand-written rows: “example accept → …” instead of “model accept → …”; Details reads
  “Example verdict (written by hand) → …” and “Example output (written by hand, not a model run)”.
- Run diff between the hand-written examples and a live run on the same rules: “1 differs from the hand-written
  examples: Fernby Labs.” / “Every verdict matches the hand-written examples.” (“model variance” only between two
  model runs).
- Quote test link: “2 real catches on the Board ›” → “Clause-check counts on the Board ›” (no invented count).
- QA fixture runs (live-layout QA states) are labelled “QA fixture, not a model call”, with no latency, cost or
  confidence, and are never stored.

## Notes for BE1 (`POST /api/try`), no change requested
- S1 sends `{rules}` for a full run and `{rules, ask_ids}` for “Retry the other N” and a row's Retry.
- Rows still missing when `done` arrives, or when the stream closes without `done`, are treated as a lost stream
  (“Lost the connection after 7 of 12.” + “Retry the other 5”), so they are re-requested by id.
- A run-level `error` (no `i`/`ask_id`) marks every row still checking as NOT CHECKED; `budget` also pauses live
  checks, `rate_limited` shows the limit notice until `retry_after_s`.
- The browser re-checks every live quote with the same clause finder: a quote with `found: false` is a decline by
  code even if the event said otherwise; offsets outside the rules are found again.
- The client gives up on a silent stream after 25 s (the server hard-stops at 12 s).
