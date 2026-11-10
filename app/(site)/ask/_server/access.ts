import 'server-only';
import { REAL_ASKERS_MODE } from '@/lib/env';
import { canAskReal } from '@/lib/server/asks';
import { getLiveState } from '@/lib/server/live';
import { getMemberProfile } from '@/lib/server/member';
import { getUser } from '@/lib/supabase/server';
import type { MemberProfile, MemberRef } from '@/lib/types';
import type { AskerProfileView, LiveInfo, RealAccess } from '@/components/ask/types';

/**
 * S2's server reads for /ask and /ask/[id]. Each one never throws: without keys (or with a database that doesn't
 * answer) the page renders its designed state, and the SAMPLE network keeps working (docs/CONTRACT.md §14).
 */

export interface AskViewer {
  user: MemberRef | null;
  access: RealAccess;
}

export function profileView(member: MemberProfile | null): AskerProfileView | null {
  if (!member || !member.name.trim() || !member.company.trim()) return null;
  const name = member.name.trim();
  return { name, first: name.split(/\s+/)[0] ?? name, company: member.company.trim(), stage: member.stage.trim(), city: member.city.trim() };
}

/** “Maya Bennett · Oakline Health · Seed · Chicago”. */
export function fromLine(p: AskerProfileView | null): string {
  return p ? [p.name, p.company, p.stage, p.city].filter(Boolean).join(' · ') : 'Your name and company, from your profile';
}

/** Who is looking and whether they may ask the REAL network (open mode: every signed-in member with a profile). */
export async function askViewer(): Promise<AskViewer> {
  try {
    const u = await getUser();
    if (!u.ok) {
      if (u.reason === 'not_configured') return { user: null, access: { kind: 'not_configured' } };
      if (u.reason === 'signed_out') return { user: null, access: { kind: 'signed_out', mode: REAL_ASKERS_MODE } };
      return { user: null, access: { kind: 'db_down' } };
    }
    const can = await canAskReal(u.user);
    if (!can.allowed) {
      const kind = can.reason === 'not_invited' || can.reason === 'profile_incomplete' || can.reason === 'db_down' ? can.reason : 'not_configured';
      return { user: u.user, access: { kind } };
    }
    const prof = await getMemberProfile(u.user.id);
    if (!prof.ok) return { user: u.user, access: { kind: prof.reason === 'db_down' ? 'db_down' : 'not_configured' } };
    const view = profileView(prof.member);
    return { user: u.user, access: view ? { kind: 'allowed', profile: view } : { kind: 'profile_incomplete' } };
  } catch {
    return { user: null, access: { kind: 'db_down' } };
  }
}

/** BE1's live state (whether the compiler and gates can run), as the islands use it. */
export async function liveInfo(): Promise<LiveInfo> {
  try {
    const s = await getLiveState();
    const until = s.paused_until ? Date.parse(s.paused_until) : NaN;
    return { state: s.state, until: Number.isNaN(until) ? null : new Date(until).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Los_Angeles' }) };
  } catch {
    return { state: 'down', until: null };
  }
}

/** The asker's profile line for the REAL status card. */
export async function askerFromLine(user: MemberRef): Promise<string> {
  try {
    const prof = await getMemberProfile(user.id);
    return fromLine(prof.ok ? profileView(prof.member) : null);
  } catch {
    return fromLine(null);
  }
}

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
