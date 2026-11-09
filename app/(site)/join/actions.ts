'use server';

import { headers } from 'next/headers';
import { requestSignInCode, verifySignInCode, type SendCodeResult, type VerifyCodeResult } from '@/lib/server/member';
import { clientIp } from '@/lib/server/ratelimit';
import { getServerClient } from '@/lib/supabase/server';

/**
 * /join server actions (owner: S3). Next checks Origin against Host for every server action (CSRF); the inputs are
 * untrusted and validated with zod in lib/server/member.ts. The network address (BE1's clientIp: Vercel's own header
 * first, which a client can't set) only feeds HMAC'd rate-limit keys; it is never stored or logged.
 */

async function requestIp(): Promise<string | null> {
  return clientIp(await headers());
}

/** Emails a 6-digit code (never a magic link). */
export async function sendCode(input: { email: string }): Promise<SendCodeResult> {
  const client = await getServerClient();
  return requestSignInCode(client.ok ? client.client.auth : null, { email: input?.email, ip: await requestIp() });
}

/**
 * Checks the code; on success the session cookies are set on this response and the members row exists. The page
 * then navigates to `next` (/me?first=1, /me, /me?carried=1 or a safe ?next=).
 */
export async function verifyCode(input: {
  email: string;
  code: string;
  sent_at: number;
  carried: { rules: string; cap: number } | null;
  next: string | null;
}): Promise<VerifyCodeResult> {
  const client = await getServerClient();
  return verifySignInCode(client.ok ? client.client.auth : null, {
    email: input?.email,
    code: input?.code,
    sent_at: input?.sent_at,
    carried: input?.carried,
    next: input?.next,
    ip: await requestIp(),
  });
}
