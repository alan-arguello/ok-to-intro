# Gate eval data

| File | What it is | Written by |
|---|---|---|
| `sample-cases.json` | SAMPLE set: the 12 sample asks × the 3 presets (36 cases). Expected verdicts are the hand-written literal reading in `lib/sample`, the reading the gate rubric was written next to, so it is **not held out**. | `npm run eval -- --write-sample` (regenerated from lib/sample; a test fails if it drifts) |
| `sample-summary.json` | The last run of the gate on the SAMPLE set (not shown on the board). | `npm run eval -- --set sample` |
| `heldout.json` | The held-out set: cases and labels written by someone who hasn't seen the rubric or the gate prompt. | that person, before any tuning |
| `heldout.lock.json` | The held-out file's sha256 and when it was frozen. `npm run eval` refuses to run if the file changed since. | `npm run eval -- --freeze`, once |
| `heldout-summary.json` | What `/board` shows (`EvalSummary` in lib/types.ts). `source: "none"` until the held-out eval has run, and the board then says “No eval run yet”. | `npm run eval` |
| `candidates/*.json` | Unlabelled drafts from claude-opus-5-5 for people to label. The drafter never labels. | `npm run eval:draft` |

## Case file format

```json
{
  "set": "heldout",
  "label": "Shown above the table",
  "author": "Full name",
  "author_note": "(relationship), who didn’t see the rubric or the gate prompt",
  "created_at": "2026-11-10",
  "cases": [
    {
      "id": "h01",
      "case_type": "fits | wrong_stage | investor | injection | polite_spam | other",
      "rules": "Happy to talk to …\nOnly if …\nNo …",
      "ask": { "text": "The ask as members read it", "subject": "Optional, ≤ 45 characters" },
      "expected": "accept | decline | ask_back",
      "notes": "Optional"
    }
  ]
}
```

Everything is fictional: invented rules, companies and founders. Ids are at most 40 characters; rules and asks at most 1,000.

## How a run is scored

`npm run eval` runs the production gate (the exact code `/api/try` and the fan-out run) 3 times over every case, plus a keyword baseline (decline when a word of a “No …” line appears, accept when another line shares a keyword, never ask). A case is right when the final verdict, after the code checks, equals the label; a gate that fails counts as not checked, so it is wrong. The table prints per case type: n, run 1, run 2, run 3 and the baseline, then the wrongly let through / wrongly blocked counts and every miss with the quotes the gate cited.
