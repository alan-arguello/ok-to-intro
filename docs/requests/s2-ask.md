# Requests from S2 (ask)

## Name two more SAMPLE outcomes in SampleAskStore.state
- File: lib/oti/storage.ts
- Change: widen `SampleAskStore.state` from `QaState<'askStatus'>` to `QaState<'askStatus'> | 'closed' | 'question'`.
- Why: the S2 status page has two outcomes the QA list doesn't name: `closed` (the asker pressed “Yes, close my ask” after a member's 2 lines) and `question` (nothing offered yet; a gate's question waits on the asker). Until then S2 writes `answered` for `closed` and `ask-back` for `question` (components/ask/sample-store.ts `sharedStateOf`), which R's /o/sample reads correctly today.
- Blocking? no.

## Carry the failed-gate count in the asker view
- File: lib/types.ts (AskerAskView), BE2 lib/server/serializer.ts
- Change: add `gates_failed: number` (the count alone, never `gates_ran`, per §d.2).
- Why: ux-spec S2 [failed-closed] REAL copy “Nothing was sent to anyone. 9 gates failed, so nothing was offered.” and the [partial-failure] line “2 gates failed and count as not checked, never as an accept.” need the number after a reload; today S2 has it only from the send stream's `done` in the same page view and otherwise says “Too many gates failed, so nothing was offered. Your ask is saved.”
- Blocking? no.

## Let a failed REAL ask be sent again
- File: BE2 lib/server/dispatch.ts `startSend`, app/api/asks/[id]/send
- Change: accept `status = 'failed'` (fail closed: nothing was offered, nobody was interrupted) as sendable once more, like `ready`.
- Why: ux-spec S2 [failed-closed] has “(Retry)” next to “Your ask is saved.”; the contract answers 409 `already_sent` for anything after `ready`. S2's REAL failed state shows “Edit and resend” (`/ask?resend=<id>`) until then, which counts as the weekly edited resend.
- Blocking? no.

## Reveal-mode waffle cells open a popover
- File: components/kit/waffle.tsx
- Change: an optional `expanded`/`controls` per cell (aria-expanded + aria-controls) next to `pressed`.
- Why: in reveal mode a cell opens a details popover (prototype a.js used aria-expanded). S2 passes `pressed` today and repeats the popover text in the cell's aria-label, so nothing is lost for screen readers; this is only the more precise pattern.
- Blocking? no.

## Say how the sample chips render in the no-key table (§14)
- File: docs/CONTRACT.md §14 (S2 row)
- Change: replace “for a sample chip's text it may prefill the 5 inputs from `lib/sample`, … never shown as found/suggested” with “a sample chip's text (Missing 2 parts, Complete) renders its hand-written parts at once as found / suggested / missing rows, labelled EXAMPLE_PARTS_LABEL “Example parts, written by hand · not a compiler run” (no request, with or without a key, like S1's authored presets); the Vague chip and any text under 6 words are refused by the compiler's code rule”.
- Why: the build does this (components/ask/compose.tsx). ux-spec §6 storyboard (“Check my ask shows 2 found · 1 suggested · 2 missing; Use, then two sample answers”) and the §8 smoke test step 2 (“Check, then Use and the sample answers, then Send”) need a suggested part to Use; the manual form has none. Every example row is an exact span of the chip's text (tests/ask/compose-model.test.ts), and the label says no compiler ran. The founder's own text still goes to the live compiler, or to the manual form when the compiler can't run.
- Blocking? no.

## Carry the fan-out's duration in the asker view
- File: lib/types.ts (AskerAskView), BE2 lib/server/serializer.ts
- Change: add `wall_ms: number | null` (send started → gates done; null until done).
- Why: ux-spec S2 meta “Sent Nov 9, 21:04 · REAL network · 40 members · 2.1 s” shows the duration at done. Today S2 has it only from the send stream's `done` in the page view that sent the ask; after a reload the meta ends at “40 members”.
- Blocking? no.
