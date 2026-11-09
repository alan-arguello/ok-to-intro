import { listMyAsks, getAskerView } from '@/lib/server/asks';
import { exportMemberData } from '@/lib/server/member';
import { getUser } from '@/lib/supabase/server';
import { jsonNoStore } from '@/lib/http';

/**
 * GET /me/export (owner: S3): a JSON download of the signed-in member's own data. Their asks appear only as the asker
 * serializer shows them (getAskerView: the four asker states, never gate_decisions or ask_members of their asks);
 * their own gate's decisions are monthly counts (the asks behind them were never shown to the member).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await getUser();
  if (!auth.ok) {
    if (auth.reason === 'error') return jsonNoStore({ error: 'db_down', message: 'Something broke on our side. Nothing was sent to anyone.' }, 503);
    // A relative Location (RFC 9110), so the redirect never depends on how the host header reached us.
    return new Response(null, { status: 303, headers: { Location: `/join?next=${encodeURIComponent('/me')}`, 'Cache-Control': 'no-store' } });
  }
  const mine = await exportMemberData(auth.user.id);
  if (!mine.ok) {
    if (mine.reason === 'not_found') return jsonNoStore({ error: 'not_found', message: 'There is no gate for this account yet.' }, 404);
    return jsonNoStore({ error: mine.reason, message: 'Something broke on our side. Nothing was sent to anyone.' }, 503);
  }

  const asks = await listMyAsks(auth.user);
  let myAsks: unknown;
  if (asks.ok) {
    const views = await Promise.all(asks.items.map((a) => getAskerView(a.id, auth.user)));
    myAsks = views.map((v, i) => (v.ok ? v.view : { id: asks.items[i]?.id, subject: asks.items[i]?.subject, outcome: asks.items[i]?.outcome }));
  } else myAsks = asks.reason === 'not_configured' ? [] : { error: 'Your asks couldn’t be read right now.' };

  const body = JSON.stringify({ exported_at: new Date().toISOString(), ...mine.data, asks: myAsks }, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ok-to-intro-export.json"',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
