# Requests for shared files

F's files are frozen during the build (docs/CONTRACT.md §a). When you need a change in one of them, append it to
`docs/requests/<owner-id>.md` (be1, be2, s1, s2, s3, r, s6, s7) and keep building against the contract as written.
The integrator merges requests after the build.

One section per request:

```
## <short title>
- File: lib/types.ts
- Change: add `foo: string | null` to `AskerAskView`
- Why: the status page needs … (ux-spec S2 “…”)
- Blocking? no (I render … meanwhile)
```
