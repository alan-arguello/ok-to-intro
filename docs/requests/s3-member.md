# Requests from S3 (member: /join, /me, /pause/[token], lib/server/member.ts, lib/server/api-tokens.ts)

## RulesReadView: a `plain` variant
- File: components/kit/clause.tsx
- Change: add `plain?: boolean` to `RulesReadViewProps`; when true, never add `is-unused` to a line.
- Why: ux-spec S3 shows the rules in ink on the first visit and for a member whose gate checked nothing yet (prototype
  me-first-1280.png). With no tallies, “unused” means nothing, but the kit marks every untouched line `.is-unused`
  (ink-2). Meanwhile styles/member.css scopes `.rules.me-rules-plain > li.is-unused { color: var(--ink); }`; delete that
  rule and pass `plain` once this lands.
- Blocking? no

## Footer links on /pause/[token]
- File: components/site/site-footer.tsx (rendered by app/layout.tsx)
- Change: let a slim page swap “Board” for “Your gate” (/me), e.g. a `links` override that SlimPage can pass.
- Why: prototype pause.html's footer reads “Your gate · Privacy · Code (MIT)”: the page is opened from a member's own
  email. Today every page gets “Board · Privacy · Code (MIT)”.
- Blocking? no

## `otp` in RateBucket (optional)
- File: lib/types.ts (and BE1's lib/server/ratelimit.ts RATE_LIMITS)
- Change: add `'otp'` to `RateBucket` if BE1 wants one limiter for everything.
- Why: the SQL already allows bucket `otp` (rate_limits check). S3 counts email-code requests and verifies itself
  (lib/server/member.ts `hitLimit`: public.hit_rate_limit with HMAC'd keys, in-memory fallback after 300 ms), because
  `RateBucket` has no `otp` and `clientKey` is BE1's.
- Blocking? no

## Contract notes (no change requested, for the integrator)
- **Guest toggle not shipped.** ux-spec §5 S3: “This toggle ships only with the guest path (cut line #1)”, and §10
  lists “the guest path and guest toggle” under Later. There is no guest path, so /me has no “Accept verified guest
  asks” switch (a control that did nothing would be dishonest). `members.accept_guests` stays false.
- **Delete order.** `deleteMember` cancels emails (BE2 `cancelMemberEmails(id, 'all')`), deletes the auth user (every
  row cascades), and only then records `member_deleted` with no member id. §b writes the audit row first with the id;
  the cascade nulls that id, so the stored row is identical, but this order can't count a delete that failed.
- **`createPauseLink` mints a new token per call** (only its HMAC is stored, so a link can't be looked up again).
  BE2: call it once per email you build. Undo on /pause only reverts that link's own pause within 24 h, and any pause
  or resume from /me or another link clears it.
- **Carried rules never overwrite.** Verify saves the playground's rules only for a member without rules. A member
  who already has rules lands on /me?carried=1, where the playground rules open as unsaved changes (“These rules came
  from the playground and aren’t saved yet.”): Save keeps them, Discard drops them. A signed-in visitor (header cookie
  hint) who opens /join without `?next=` goes straight to /me (or /me?carried=1); `?next=` means a protected page just
  bounced them, so /join stays put (no loop on a stale cookie).
- **Asker profile on /me.** Settings carry Company, Stage and City next to Name (S2's “Sent as”, `canAskReal`
  `profile_incomplete`), with “When you ask, the member who gets it sees “Priya Shah · Oakline Health · Seed ·
  Chicago”.” Anchors: `#asks`, `#settings`, `#token`, `#delete`.
- **A waiting offer stays on /me while paused.** The /pause lede says an ask already waiting stays open, so /me keeps
  “1 ask is waiting on you” while paused (the prototype hid it); Resume stays the one black pill and “Review the ask”
  is an outline button in that state only.
- **/pause reads BE2's redirects by the member's real state** (`components/member/pause-state.ts`): `?error=db_down` →
  “Something broke on our side. Nothing changed.”; `?error=invalid` on a link that still works (an Undo past 24 h, or
  after a pause or resume elsewhere) → “This link can’t undo that pause anymore…”, never “This pause link doesn’t
  work”; a gate that isn't on yet gets “Your gate isn’t on yet” instead of the form.
- **Verify attempts are also capped per email (15 per 15 min, across codes).** The per-code count (5) is keyed by the
  send time the browser echoes back, so on its own a client could reset it; the email cap bounds a guesser at 15 tries
  per quarter hour. Client addresses come from BE1's `clientIp` (Vercel's own header first) and are only HMAC'd.

## Setup for Alan (outside the repo)
- Supabase Auth → Email templates: put `{{ .Token }}` (and no `{{ .ConfirmationURL }}`) in BOTH the **Magic Link** and
  the **Confirm signup** templates, subject “{{ .Token }} is your OK to Intro code”. Supabase sends a NEW address the
  Confirm signup template (signInWithOtp signs them up), and a returning one the Magic Link template; `verifyOtp` with
  `type: 'email'` accepts the code from either. /join never sends or accepts magic links.
- Email OTP expiration: **900 s**. Supabase answers the same `otp_expired` for a wrong code and an expired one, so /join
  reads a rejected code older than 15 minutes as “That code expired.” (`OTP_TIMING.codeTtlS` in
  components/member/copy.ts).
- Raise “sign ups and sign ins” and “token verifications” rate limits: /join calls `signInWithOtp` / `verifyOtp` from
  server actions, so Supabase sees the server's address. The per-address and per-email limits are enforced in the app
  (3 codes per email per 15 min, 10 requests per address per 10 min, 5 tries per code, 15 tries per email per 15 min,
  30 verifies per address per 10 min).
- Custom SMTP (Resend) at ≥ 100/h: the built-in SMTP only reaches the project's team, and /join says “This instance can
  only email codes to its own team for now.” when Supabase answers `email_address_not_authorized`.
- Env: `TOKEN_HMAC_SECRET` (Claude Code tokens, pause links), `RATE_LIMIT_SALT_SECRET` (the Postgres counter for the
  code limits; without it the limits are per server instance), plus the three Supabase variables. Sign-in shows
  “Sign-in isn’t set up on this instance.” until both the public Supabase variables and the service role are set.
