'use server';

import { headers } from 'next/headers';
import { deleteGate, submitGateAsk, type AskOutcome } from '@/lib/server/personal-gates';
import { clientKey } from '@/lib/server/ratelimit';

async function rateKey(): Promise<string | null> {
  const h = await headers();
  return clientKey(new Request('http://localhost/', { headers: h }));
}

/** Sends one ask to a personal gate (the gate runs on the owner's rules; every verdict is stored for the owner). */
export async function askGateAction(slug: string, input: unknown): Promise<AskOutcome> {
  if (typeof slug !== 'string') return { ok: false, reason: 'not_found' };
  return submitGateAsk(slug, input, await rateKey());
}

/** Deletes the gate and every ask (cascade). Needs the owner token. */
export async function deleteGateAction(slug: string, token: string): Promise<{ ok: boolean }> {
  if (typeof slug !== 'string' || typeof token !== 'string') return { ok: false };
  const res = await deleteGate(slug, token);
  return { ok: res.ok };
}
