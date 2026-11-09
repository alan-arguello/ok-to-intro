# OK to Intro

A founder asks the network for one specific person. Each member's gate checks the ask against rules that member
wrote and a hard monthly cap, so people only see asks they agreed to see. Names are exchanged after two human yeses,
and every intro is followed to an outcome.

> Independent project, not affiliated with Y Combinator.

<!-- The integrator finishes this README after the build: what it is, the live URL, the 2-minute reviewer path,
     the video, the eval, the install commands, and the honest status of every number. -->

## Run it locally

Requirements: Node 22.22+ or 24.15+ (package.json `engines`) and npm.

```sh
npm install
cp .env.example .env.local   # optional: every feature works in its designed “not configured” state without keys
npm run dev                  # http://localhost:3200
```

| Command | What it does |
|---|---|
| `npm run dev` | dev server on :3200 (dist dir `.next-dev`) |
| `npm run check` | typecheck, lint and tests |
| `npm run build:check` | production build in a throwaway dist dir |
| `npm test` | vitest (PGlite runs the migrations for the database tests) |
| `npm run recordings:authored` | regenerate the hand-written SAMPLE recordings |
| `npm run record:presets` | re-record the presets with the production gate (needs `ANTHROPIC_API_KEY`) |
| `npm run eval` | the held-out eval |
| `npm run race` | 20 concurrent asks, 1 free slot, exactly 1 offer (needs a Supabase project: URL + service-role key) |
| `npm run smoke` | the pre-deploy smoke test |

## How it's built

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, layout, the three flows, decisions.
- [docs/CONTRACT.md](docs/CONTRACT.md): interfaces, routes, event shapes, privacy and honesty rules.
- [supabase/migrations](supabase/migrations): the schema, RLS and the Postgres cap (`reserve_slot`).

## License

MIT © 2026 Alan Arguello
