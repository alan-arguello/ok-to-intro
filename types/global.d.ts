// Committed so `npm run typecheck` works on a fresh clone before `next dev` or `next build` writes next-env.d.ts
// (which is gitignored because its route-types import depends on NEXT_DIST_DIR).
/// <reference types="next" />
/// <reference types="next/image-types/global" />
