# Requests and notes from BE2 (network)

BE2 built against the contract as written. Nothing below blocks anyone; each item says what BE2 does meanwhile.

## 1. Types for the 0002 functions
- File: lib/supabase/database.types.ts
- Change: add every function in `supabase/migrations/0002_network.sql` under `public.Functions` (all take named
  `p_…` arguments and return `jsonb`, so `Returns: Json`): `net_asker_access`, `net_create_ask`, `net_begin_send`,
  `net_record_decision`, `net_finish_send`, `net_ask_owner`, `net_advance`, `net_tick_ask`, `net_due_asks`,
  `net_ask_snapshot`, `net_ask_snapshots`, `net_withdraw_ask`, `net_resolve_ask`, `net_answer_question`,
  `net_rerun_counts`, `net_offer_view`, `net_respond_offer`, `net_set_no_reason`, `net_pending_for_member`,
  `net_intro_view`, `net_checkin_view`, `net_save_checkin`, `net_outbox_claim`, `net_outbox_result` (returns
  `undefined`), `net_outbox_cancel`, `net_outbox_due`, `net_unsent_asks`, `net_resume_gates`,
  `net_fail_missing_reruns`, `net_checkins_due`, `net_cleanup`, plus `net__audit` (returns `undefined`; the only
  `net__` helper the server calls, for `recordAudit`). 0002 adds no tables or columns.
- Why: CONTRACT §db asks 0002+ to update the hand-written types in the same change, but the file is F's.
- Blocking? no. `lib/server/audit.ts` `rpc()` calls them untyped and every caller checks the shape it gets back.

## 2. `gates_failed` on the asker view (S2's request, BE2 side ready)
- File: lib/types.ts (`AskerAskView`), then lib/server/serializer.ts
- Change: add `gates_failed: number` to `AskerAskView`; in `serializeForAsker` return
  `gates_failed: failedGateCount(snapshot)` (already exported from serializer.ts and tested). It is the count alone
  (a gate that answered with no verdict, or never answered), never how many gates ran (§d.2).
- Blocking? no. S2 has the count from the send stream's `done` meanwhile.

## 3. `/api/health` and BE2 agree on when the REAL network is on
- File: lib/server/health.ts (BE1), or lib/env.ts (F) with a `realNetworkReady` flag
- Change: report `network: 'real'` only when `flags.realNetwork && flags.hasResend`.
- Why: BE2's `networkConfigured()` (lib/server/audit.ts) now also needs email: members learn about an offer by email
  and an intro is an email to both people, so an instance with a database but no Resend key shows every REAL surface's
  “not set up on this instance” state instead of telling a member “We emailed you and Lucía” when nothing went out.
  `/api/health` still says `network: 'real'` in that state.
- Blocking? no.

## 4. Offer pages: give the server actions time for after-response work
- File: app/(slim)/o/[token]/page.tsx and app/(slim)/c/[token]/page.tsx (R)
- Change: `export const maxDuration = 60;`
- Why: BE2 runs what an action causes after the response (next/server `after`) so the POST + 303 stays fast: after a
  No, the next member's offer email; after an OK, the check-in scheduling and possibly a queued ask's fan-out (up to
  ~12 s); after a check-in answer, the reminder or the outcome note. Every one of these is also picked up by the
  daily cron, so a cut-short `after` delays it by up to a day rather than losing it.
- Blocking? no.

## 5. What R and S6 see when an intro email fails (no change needed; FYI)
- `respondToOffer(…, 'ok')` sends the intro email before answering. If it doesn't go out (one immediate retry), the OK
  still stands in the database, and the result is `{ ok: false, reason: 'db_down', offer }` with `offer.state`
  reading `'pending'` until the email is out: /o shows [post-failed] (“Didn't go through… tap again; nothing happens
  twice”) on the OK confirm, and the next POST (any action) retries the email. The asker's view shows no intro until
  then. For an `ok` offer, `OfferView.responded_at` is the moment the intro email went out (“We emailed you … at”).
- The daily cron sends intro emails that never went out (up to 5 tries) and then schedules their check-ins;
  check-ins are never sent for an intro whose email didn't go out.

## 6. Custom-text SAMPLE answers need the instance that ran the send
- File: lib/types.ts `SampleAnswerInput` (and S2/S6 callers)
- Change (optional): add `asked_cells?: number[]` (the waffle positions whose gate asked this question, from the
  stream's cells). BE2 would then rerun exactly those gates without server memory (it's SAMPLE, so trusting the
  client about fictional members is harmless; the sample_send rate limit caps the cost).
- Why: for the 3 sample asks the recorded file says who asked; for a visitor's own text (live gates only) this
  instance remembers it for an hour in memory, so on another serverless instance `POST /api/asks/sample/answer`
  answers 400 “This sample ask is no longer on the server. Send it again.”
- Blocking? no (custom-text SAMPLE sends need a model key anyway).

## 7. Who writes `compile_refused` (BE1's question)
- BE2 agrees with BE1: refusals happen in BE1's `startCompile`, so BE1 should call
  `recordAudit('compile_refused', { detail: { kind } })` there. BE2 writes none.

## 8. Not built (cut line)
- The member's +14 day check-in when the asker never answers (ux-spec S5): `board_snapshot()` counts only the asker's
  d14 answers, so it would add an email without adding to the board. The asker's +1, the member's +1 and the asker's
  +14 day check-ins are built, scheduled with Resend and backed by the daily cron.
- Guest asks (cut line #1): `prefilter_members` has no guest path, and no surface sends guest asks.

## 9. Answers to S2's requests (docs/requests/s2-ask.md)
- “Let a failed REAL ask be sent again”: done. `POST /api/asks/[id]/send` (and `startSend`) accept a `failed` ask
  and start it over (nothing was offered, nobody was interrupted), so [failed-closed] (Retry) can call it. A failed
  ask still counts as one of the asker's 3 open asks until it is retried or withdrawn, so a retry never makes a 4th.
- “Carry the failed-gate count in the asker view”: see item 2.

## Notes for the integrator
- `npm run race` needs `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` of a dev project for the concurrent
  run (20 `create_offer` RPCs at once on throwaway `race-…@example.invalid` users, deleted afterwards). Without them it
  runs the logical check on PGlite, says so, prints `SKIPPED` and exits 2: it never prints “passed”.
- Asker-visible copy BE2 writes lives next to its route (`app/api/asks/**`) or in lib/server (refusal messages);
  shared strings come from lib/oti/copy.ts.
