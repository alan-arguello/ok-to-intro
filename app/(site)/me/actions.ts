'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';
import { isPauseChoice, pauseUntil, type PauseChoice } from '@/components/member/copy';
import { createApiToken, revokeApiToken } from '@/lib/server/api-tokens';
import { deleteMember, pauseMember, resumeMember, saveMemberSettings, turnOnGate, type SettingsInput, type SettingsResult } from '@/lib/server/member';
import { getServerClient, getUser } from '@/lib/supabase/server';
import type { MemberRef } from '@/lib/types';

/**
 * /me server actions (owner: S3). Every action re-reads the member from the verified session (never an id from the
 * browser); Next checks Origin against Host (CSRF); inputs are validated with zod in lib/server/member.ts.
 * Results are small shapes for the UI, never raw rows.
 */

export type MeFail = { ok: false; reason: 'signed_out' | 'not_configured' | 'db_down' | 'bad_input' | 'not_found' | 'invalid'; field?: string };

async function member(): Promise<MemberRef | null> {
  const res = await getUser();
  return res.ok ? res.user : null;
}

const SIGNED_OUT: MeFail = { ok: false, reason: 'signed_out' };

/** Settings form (on or paused): profile, asker profile, link, cap, matched-line toggle, rules (a version if changed). */
export async function saveSettingsAction(input: SettingsInput): Promise<SettingsResult | MeFail> {
  const user = await member();
  if (!user) return SIGNED_OUT;
  const res = await saveMemberSettings(user.id, input, { requireName: true });
  if (res.ok && res.rules_changed) refresh();
  return res;
}

/** First visit: saves everything and turns the gate on. */
export async function turnOnAction(input: SettingsInput): Promise<SettingsResult | MeFail> {
  const user = await member();
  if (!user) return SIGNED_OUT;
  const res = await turnOnGate(user, input);
  if (res.ok) refresh();
  return res;
}

export async function pauseAction(choice: PauseChoice): Promise<{ ok: true; paused_until: string | null } | MeFail> {
  if (!isPauseChoice(choice)) return { ok: false, reason: 'bad_input' };
  const user = await member();
  if (!user) return SIGNED_OUT;
  const res = await pauseMember(user.id, pauseUntil(choice, Date.now()));
  return res.ok ? { ok: true, paused_until: res.paused_until } : { ok: false, reason: res.reason };
}

export async function resumeAction(): Promise<{ ok: true } | MeFail> {
  const user = await member();
  if (!user) return SIGNED_OUT;
  const res = await resumeMember(user.id);
  return res.ok ? { ok: true } : { ok: false, reason: res.reason };
}

/** Creates the Claude Code token; the raw token is in this response only (it is never stored). */
export async function createTokenAction(): Promise<{ ok: true; token: string; created_at: string } | MeFail> {
  const user = await member();
  if (!user) return SIGNED_OUT;
  return createApiToken(user.id);
}

export async function revokeTokenAction(): Promise<{ ok: true } | MeFail> {
  const user = await member();
  if (!user) return SIGNED_OUT;
  const res = await revokeApiToken(user.id);
  return res.ok ? { ok: true } : res;
}

/**
 * Deletes the member's data (lib/server/member.ts deleteMember: emails cancelled, the auth user and every row gone),
 * then signs this browser out. The page then shows /me/deleted.
 */
export async function deleteAction(): Promise<{ ok: true } | MeFail> {
  const user = await member();
  if (!user) return SIGNED_OUT;
  const res = await deleteMember(user.id);
  if (!res.ok) return { ok: false, reason: res.reason };
  try {
    const client = await getServerClient();
    // The user no longer exists: auth-js ignores the 403/404 from logout and still clears the session cookies.
    if (client.ok) await client.client.auth.signOut({ scope: 'local' });
  } catch {
    /* the cookies are cleared below either way */
  }
  const store = await cookies();
  for (const c of store.getAll()) if (/^sb-[a-z0-9-]+-auth-token(?:[.-].*)?$/i.test(c.name)) store.delete(c.name);
  return { ok: true };
}
