import 'server-only';
import { getLiveState } from '@/lib/server/live';
import { getMemberProfile } from '@/lib/server/member';
import type { MemberProfile, MemberRef } from '@/lib/types';
import type { AskerProfileView, LiveInfo } from '@/components/ask/types';

/**
 * S2's server reads for /ask and /ask/[id]. Each one never throws: without keys (or with a database that doesn't
 * answer) the page renders its designed state, and the SAMPLE network keeps working (docs/CONTRACT.md §14).
 */

export function profileView(member: MemberProfile | null): AskerProfileView | null {
  if (!member || !member.name.trim() || !member.company.trim()) return null;
  const name = member.name.trim();
  return { name, first: name.split(/\s+/)[0] ?? name, company: member.company.trim(), stage: member.stage.trim(), city: member.city.trim() };
}

/** “Maya Bennett · Oakline Health · Seed · Chicago”. */
export function fromLine(p: AskerProfileView | null): string {
  return p ? [p.name, p.company, p.stage, p.city].filter(Boolean).join(' · ') : 'Your name and company, from your profile';
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
