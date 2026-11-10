# Decisions from Alan (Mon Nov 9, 08:30 PT)

For the integrator and every builder. These override the defaults in the specs.

1. **Domain.** The app lives at `https://ok-to-intro.vercel.app` (`NEXT_PUBLIC_SITE_URL`). Email is sent from a subdomain of Alan's own domain: planned `mail.alanarguello.me`, with From set through `EMAIL_FROM` (for example `OK to Intro (Alan Arguello) <asks@mail.alanarguello.me>`). No copy may hardcode either value.
2. **Who can ask the REAL network at launch: anyone who is signed in.** There is no invite-only gate.
   - Keep the allowlist mechanism, but make it optional. When `REAL_ASKERS` is unset or `*`, every signed-in member can send REAL asks.
   - Signed-out visitors on /ask see "Sign in to ask the real network", not "invited only".
   - Keep every protection: 3 open asks per asker, one edited resend a week, rate limits, the compiler's refusal of vague asks, gates and caps.
3. **External services are set up by the main session, not by agents.** That covers the Supabase project, the GitHub repo `alan-arguello/ok-to-intro`, the Vercel project and DNS. Agents keep everything working without keys.
