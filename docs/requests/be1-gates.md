# Requests and notes from BE1 (gates)

BE1 built against the contract as written. Nothing below blocks anyone; each item says what BE1 does meanwhile.

## 1. `TryRequest.mode`
- File: lib/types.ts
- Change: add `mode?: 'live' | 'recorded' | 'auto'` to `TryRequest` (BE1 exports the same union as `TryMode` from lib/server/gate.ts).
- Why: an unedited preset can be served from data/recorded/presets.json with no model call, but by default /api/try must stream only live verdicts (CONTRACT §c), because the playground engine labels every /api/try gate as live and its “Run live” on an unedited preset needs the designed 429 / 503 notices (ux-spec S1 [rate-limited], [api-down]).
  - absent or `live`: live, or 400 / 429 / 503 before streaming. Never a recorded row.
  - `recorded`: an unedited preset's recorded run (plan `mode: 'recorded'`, each gate labelled by the file's source: `authored` today, `recorded` after `npm run record:presets`).
  - `auto`: live when possible; an unedited preset falls back to its recorded run when live is off / down / budget or the address is rate-limited (presets are unlimited). MCP `try_rules` (S6) may send it instead of handling the 503 itself (CONTRACT §b), as long as the receipt reads `plan.mode` and each gate's `source`.
- Blocking? No. /api/try and `startTry` already read `mode`; callers typed with `TryRequest` can pass it with a cast until the type has it.

## 2. A row error kind for “the API rejected the call”
- File: lib/types.ts (`GateErrorKind`), lib/oti/copy.ts (`GATE_FAILURE_COPY`)
- Change: add `'unavailable'` to `GateErrorKind`, with copy such as “Live checks couldn’t reach the model. A failed gate never counts as an accept.”
- Why: a 401/403/404 or an unexpected 400 mid-run (a revoked key, a misconfigured workspace) is `GateResult.kind: 'unavailable'`. The playground's row vocabulary has no such kind, so /api/try streams those rows as `overloaded` (“The model API was overloaded…”), which is not quite true. `CompileErrorKind` already has `unavailable`.
- Blocking? No. Rows render NOT CHECKED either way; five in a row turn the banner to `down`.

## 3. Who writes `compile_refused`
- File: docs/CONTRACT.md §db (audit writers)
- Change: decide one writer. The contract lists BE2, but refusals happen in BE1's `startCompile` (YC application and too-short/“Vague” asks by code before any model call; vague and YC decisions by the model). BE1 records nothing today, so the board's `compile_refused` count stays whatever BE2 writes. Suggest: BE1 calls `recordAudit('compile_refused', { detail: { kind } })` from `startCompile`, and BE2 doesn't.
- Blocking? No.

## 4. What `decided_by: 'clause_check'` means, and what the board counts
- Files: docs/CONTRACT.md §b, lib/server/board.ts (S7), supabase `board_snapshot().quotes_not_found`
- BE1 sets `decided_by: 'clause_check'` whenever code overrides the model's verdict: a quote not found in the rules, an accept or ask_back with no quote at all, or an ask_back whose question breaks the rules (8 types, 100 characters, no URLs, paths or emails). `model_verdict` keeps what the model said; `reason` is code's sentence.
- Refusals and unparseable output come back as `{ok:false, kind: 'refused' | 'parse', decision}` where `decision.decided_by` is `'gate'` (no model verdict existed to override) and `decision.reason` is `GATE_FAILURE_COPY[kind]`. BE2 persists `error_kind` (gate_decisions has the column), which is how they are told apart.
- The board's “quotes not found” counts every `clause_check` row, so it includes the (rare) question-rule overrides. Suggest the label “code overrode the gate” or counting only rows whose `cited` has a `found: false` entry.

## 5. Quotes are widened to whole words
- The clause check uses lib/oti `findClause` (unchanged), then widens a quote that starts or stops inside a word to the whole word (`lib/server/gate.ts` `snapToWords`), and treats a quote under 4 characters as not found (“No” or “a” would match anything). Offsets in every `cited` entry index the exact rules text sent and always cover whole words. Read views must render `rules.slice(start, end)` from these offsets (as the contract already says), not re-run `findClause`.

## 6. Cost of every call, refusals included
- `GateResult`'s failure shape has no cost, but a refusal or an unparseable answer was billed. `runGateDetailed` (lib/server/gate.ts, same input) returns `{ result, cost_usd, usage, request_id }` for every call. BE2 can use it to fill `gate_decisions.cost_usd` for refused/parse rows. Spend is already added to the daily budget either way.

## 7. The estimated per-gate cost
- File: lib/sample/cost.ts (`COST.perGate`, `estimate: true`)
- Change: after `npm run bench` runs with the key, replace `perGate` with `mean_cost_usd` from data/recorded/bench.json and set `estimate: false`.
- Blocking? No: copy says “about” while it's an estimate.

## 8. The SAMPLE compile chips
- The compile event shapes have no `source` field, so the server never streams hand-written parts as found/suggested. BE1 decides two chip cases by code with or without a key: the “Vague” chip (exact match) and YC-application asks stream `plan` → `refused` with the ux-spec copy. The “Missing 2 parts” and “Complete” chips compile live like any text; without live calls /api/compile answers 503 and /ask shows its manual form prefilled from lib/sample and labelled as hand-written (CONTRACT §14).
- If recorded compiler runs for the chips are wanted later: add `source?: 'live' | 'recorded'` and `recorded_at?` to `CompilePlanEvent` and BE1 records them in `npm run record:presets`.

## 9. JSON only on /api/try and /api/compile
- Both routes answer 400 unless `Content-Type: application/json`. A cross-site page can then only call them through a CORS preflight, which fails (no CORS headers), so other sites can't spend the model budget from visitors' browsers. `postSse` already sends the header; curl users add `-H 'content-type: application/json'`.

## 10. Request ids in the playground's raw trace (optional)
- File: lib/types.ts (`TryGateEvent`)
- Change: add `request_id?: string | null` so /api/try can stream each gate's Anthropic request id for the raw trace (tech.md: “Show the request-id in the raw trace”). `GateResult` already carries it, and recorded files keep it per gate.
- Blocking? No. /api/try doesn't send it today.

## 11. Copy in model-written text
- Gate reasons and questions, and the compiler's subject, topic and suggested “who you need”, get curly quotes and apostrophes (`curly` in lib/server/gate.ts) so they read like the rest of the product. The member's and the founder's own words (quotes, found parts) are never changed.

## 12. ANTHROPIC_BASE_URL
- The Anthropic SDK honours `ANTHROPIC_BASE_URL` from the environment. Nothing in the app sets it; BE1 used it only to run the offline scripts end to end against a local fake API. No change needed in lib/env.ts.
