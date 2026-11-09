import { capMonth, DAY_MS, nextMonthStart } from '@/lib/oti/time';
import { pauseByToken, undoPauseByToken } from '@/lib/server/member';

/**
 * Owner: BE2. POST /api/pause?token=… — one handler for List-Unsubscribe-Post (body “List-Unsubscribe=One-Click”,
 * RFC 8058: pauses until turned back on and stops scheduled check-in emails) and the /pause/[token] page's plain HTML
 * form (`<form method="post" action="/api/pause">`, not a server action; fields `token`, `until` = `2w` | `month` |
 * `off` | `undo`), which gets a 303 back to `/pause/<token>?done=<until>` (or `?error=<reason>`). No sign-in: the
 * token is the capability; it can pause, and undo its own pause within 24 h (S3's pauseByToken / undoPauseByToken).
 * No Origin check: mail clients POST one-click unsubscribes from their own servers.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CHOICES = ['2w', 'month', 'off', 'undo'] as const;
type Choice = (typeof CHOICES)[number];

function untilFor(choice: Exclude<Choice, 'undo'>, now: number): string | null {
  if (choice === '2w') return new Date(now + 14 * DAY_MS).toISOString();
  if (choice === 'month') return nextMonthStart(capMonth(now)).toISOString();
  return null; // until turned back on
}

/**
 * A mail client that opens the List-Unsubscribe link instead of POSTing to it (or a person pasting it) lands on the
 * /pause page, which asks before it pauses: a GET never changes anything (link scanners fetch GETs).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = String(url.searchParams.get('token') ?? '').trim();
  return Response.redirect(new URL(`/pause/${encodeURIComponent(token || 'invalid')}`, url), 303);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const token = String(form?.get('token') ?? url.searchParams.get('token') ?? '').trim();
  const oneClick = form?.get('List-Unsubscribe') === 'One-Click';

  if (oneClick) {
    const res = token ? await pauseByToken(token, null, { stopEmails: true }) : ({ ok: false, reason: 'invalid' } as const);
    const text = res.ok
      ? 'Paused. No new asks will reach you until you turn them back on.'
      : res.reason === 'not_configured'
        ? 'Not paused: pausing isn’t set up on this instance.'
        : res.reason === 'db_down'
          ? 'Not paused: something broke on our side. Try again in a minute.'
          : 'Not paused: this link doesn’t match a member.';
    return new Response(text, {
      status: res.ok ? 200 : res.reason === 'not_configured' || res.reason === 'db_down' ? 503 : 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const raw = String(form?.get('until') ?? 'off');
  const back = new URL(`/pause/${encodeURIComponent(token || 'invalid')}`, url);
  if (!token || !(CHOICES as readonly string[]).includes(raw)) {
    back.searchParams.set('error', token ? 'bad_input' : 'invalid');
    return Response.redirect(back, 303);
  }
  const choice = raw as Choice;
  const res = choice === 'undo' ? await undoPauseByToken(token) : await pauseByToken(token, untilFor(choice, Date.now()));
  back.searchParams.set(res.ok ? 'done' : 'error', res.ok ? choice : res.reason);
  return Response.redirect(back, 303);
}
