# Requests from R (recipient: /o, /c, emails)

## A footer slot for pages whose footer follows the recipient
- File: components/site/site-footer.tsx, app/layout.tsx (F)
- Change: let a page lead the shared footer with its own links (for example a `footerLinks` prop on `SlimPage` that
  renders the footer itself, with the root layout skipping `SiteFooter` for slim pages), or render a
  `<nav id="footer-lead">` slot a page can fill.
- Why: ux-spec S5 “Footers follow the recipient: askers get Your ask · Delete my data; members get Pause all asks ·
  Change your rules · Delete my data”, and the prototype's offer page leads with Pause all asks. Today R renders the
  same footer markup with those links (components/offer/recipient-footer.tsx, `FOOTER_LINE`/`FOOTER_LINKS` from
  lib/site.ts) and hides the shared one on /o and /c with one rule in styles/offer.css:
  `body:has(> footer.offer-footer) > footer.site-footer:not(.offer-footer) { display: none; }`. When the slot
  exists, delete that rule and pass the links instead.
- Blocking? no

## The ask id on a check-in
- File: lib/types.ts (`CheckinView`), lib/server/checkins.ts (BE2)
- Change: add `ask_id: string | null` to `CheckinView` (the asker's own ask; null for the member's check-in).
- Why: the asker's footer link “Your ask” (ux-spec S5, CONTRACT §links `/ask/<id>`). Without it a REAL asker's
  “Your ask” opens `/me#asks`.
- Blocking? no

## `/pause/sample` as a SAMPLE page
- File: app/(slim)/pause/[token]/page.tsx (S3)
- Change: render the pause confirm for the token `sample` the way /o/sample and /c/sample work: fictional member,
  a SAMPLE tag, buttons that show what happens and change nothing.
- Why: every SAMPLE surface links “Pause all asks” to `/pause/sample` (the /o/sample and /c/sample footers, the
  footers of all sample emails at /emails/*). Today it shows the instance's “not set up” or “link doesn't work” copy.
- Blocking? no

## Decisions R made that the integrator should know
- Without Supabase (or without `TOKEN_HMAC_SECRET`), a REAL `/o/<token>` or `/c/<token>` renders “Offers aren’t set
  up on this instance” / “Check-ins aren’t set up on this instance” with “Nothing was sent to anyone.” and a link to
  the SAMPLE page. CONTRACT §14 said `invalid` and the build brief said “Something broke on our side”; both would
  misstate what happened (§e.8: not configured is not an outage, and the link may well be valid). A database error
  renders the designed “Something broke on our side. Nothing was sent to anyone. (Try again)”.
- The intro email goes to both people in one message, so its “Pause asks” link opens `/me` and it carries no
  List-Unsubscribe header: a member's pause token in that message would let the asker pause the member.
- The offer email's preheader quotes the matched rule cut at a word (40 characters, “…”), so the cap usage and the
  reply-by day survive an inbox preview, as in the spec's example.
- `questionEmail` is built and shown at /emails/question labelled “Not sent yet”: BE2 doesn't send it (ux-spec lists
  it under Later).
