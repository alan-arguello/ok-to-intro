import { pauseByToken } from '@/lib/server/member';
import { nextMonthStart, capMonth, DAY_MS } from '@/lib/oti/time';

/**
 * Owner: BE2. POST /api/pause?token=… — one handler for List-Unsubscribe-Post (body “List-Unsubscribe=One-Click”,
 * pauses until turned back on and stops scheduled emails) and the /pause/[token] form (fields `token`,
 * `until` = `2w` | `month` | `off`), which gets a 303 back to `/pause/<token>?done=1`. No sign-in: the token is the
 * capability, and pausing is the only thing it can do (S3's pauseByToken).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function untilFor(choice: string | null): string | null {
  if (choice === '2w') return new Date(Date.now() + 14 * DAY_MS).toISOString();
  if (choice === 'month') return nextMonthStart(capMonth()).toISOString();
  return null; // until turned back on
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const token = String(form?.get('token') ?? url.searchParams.get('token') ?? '');
  const oneClick = form?.get('List-Unsubscribe') === 'One-Click';
  const res = await pauseByToken(token, oneClick ? null : untilFor(form ? String(form.get('until') ?? '') : null), { stopEmails: oneClick });
  if (oneClick) return new Response(res.ok ? 'Paused.' : 'Not paused.', { status: res.ok ? 200 : res.reason === 'invalid' ? 404 : 503 });
  const back = new URL(`/pause/${encodeURIComponent(token)}`, url);
  back.searchParams.set(res.ok ? 'done' : 'error', res.ok ? '1' : res.reason);
  return Response.redirect(back, 303);
}
