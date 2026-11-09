import 'server-only';
import { z } from 'zod';

/**
 * Server environment, parsed once with zod. Never throws at import: a missing or invalid value is
 * `undefined`, its feature flag is false, and the problem is listed in `envProblems` (names only, never values).
 * Features switch on when their variables appear; nothing here invents or hardcodes a key.
 *
 * Client code must not import this file (it is `server-only`). Client components get what they need as props,
 * or read NEXT_PUBLIC_* variables literally (see lib/site.ts and lib/supabase/browser.ts).
 */

const optionalString = z.string().trim().min(1).optional();
const optionalUrl = z.string().trim().url().optional();

const emailList = z
  .string()
  .optional()
  .transform((raw) =>
    (raw || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)),
  );

const positiveNumber = z.coerce.number().positive().max(10_000).optional();

const schema = {
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  NEXT_PUBLIC_SITE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_WORKSPACE_ID: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  CRON_SECRET: z.string().trim().min(16).optional(),
  TOKEN_HMAC_SECRET: z.string().trim().min(32).optional(),
  RATE_LIMIT_SALT_SECRET: z.string().trim().min(16).optional(),
  DAILY_BUDGET_USD: positiveNumber,
  REAL_ASKERS: emailList,
  QA_STATES: z.enum(['0', '1']).optional(),
} as const;

type Schema = typeof schema;
export type Env = { [K in keyof Schema]: z.output<Schema[K]> };

export interface EnvProblem {
  key: keyof Schema;
  message: string;
}

function parseEnv(source: Record<string, string | undefined>): { env: Env; problems: EnvProblem[] } {
  const out: Record<string, unknown> = {};
  const problems: EnvProblem[] = [];
  for (const key of Object.keys(schema) as (keyof Schema)[]) {
    const raw = source[key];
    const value = raw === undefined || raw === '' ? undefined : raw;
    const parsed = schema[key].safeParse(value);
    if (parsed.success) out[key] = parsed.data;
    else {
      out[key] = key === 'REAL_ASKERS' ? [] : undefined;
      problems.push({ key, message: parsed.error.issues[0]?.message ?? 'invalid value' });
    }
  }
  return { env: out as Env, problems };
}

const parsed = parseEnv(process.env);

/** Parsed server environment. Values are `undefined` when missing or invalid. */
export const env: Readonly<Env> = Object.freeze(parsed.env);

/** Invalid variables, by name. Reported by /api/health without values. */
export const envProblems: readonly EnvProblem[] = Object.freeze(parsed.problems);

/** The daily model budget in USD (ux-spec §8: an app-level cap below the Anthropic workspace limit). */
export const DAILY_BUDGET_USD: number = env.DAILY_BUDGET_USD ?? 10;

/**
 * Feature flags. Each one is true only when every variable the feature needs is present and valid.
 * - hasAnthropic: live gates (/api/try), the compiler (/api/compile) and REAL fan-outs can call the model.
 * - hasSupabase: sign-in with an email code and user-scoped reads (anon key + URL).
 * - hasSupabaseAdmin: server writes with the service role (members, asks, offers, the board).
 * - hasTokenSecret: email links can be minted and verified (offer, check-in and pause tokens are HMAC'd).
 * - realNetwork: everything the REAL network needs in the database layer.
 * - hasResend: emails can be sent (offers, intros, check-ins).
 * - hasCron: /api/cron/* accepts the Vercel cron bearer.
 * - hasRateLimitSalt: per-IP limits can use the Postgres counter (otherwise the in-memory fallback).
 * - isQA: `?state=` and `?degraded=` are honoured and /kit renders (any non-production build, or QA_STATES=1).
 */
export const flags = Object.freeze({
  hasAnthropic: Boolean(env.ANTHROPIC_API_KEY),
  hasSupabase: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  hasSupabaseAdmin: Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY),
  hasTokenSecret: Boolean(env.TOKEN_HMAC_SECRET),
  realNetwork: Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY && env.TOKEN_HMAC_SECRET,
  ),
  hasResend: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
  hasCron: Boolean(env.CRON_SECRET),
  hasRateLimitSalt: Boolean(env.RATE_LIMIT_SALT_SECRET),
  isQA: process.env.NODE_ENV !== 'production' || env.QA_STATES === '1',
});

export type Flags = typeof flags;

/** Shorthands, so call sites read naturally: `if (!hasAnthropic) …`. */
export const { hasAnthropic, hasSupabase, hasSupabaseAdmin, hasTokenSecret, realNetwork, hasResend, hasCron, isQA } = flags;

/** REAL askers allowlist from the environment (lower-cased). The server seeds the `real_askers` table from it. */
export const REAL_ASKERS: readonly string[] = Object.freeze([...(env.REAL_ASKERS ?? [])]);

/**
 * Who may ask the REAL network (docs/requests/alan.md, Nov 9): `open` when REAL_ASKERS is unset, empty or `*`
 * (every signed-in member with a complete asker profile); `allowlist` when it lists emails (only those, plus
 * `real_askers` rows Alan adds). A value with no valid email is still `allowlist` (fails closed: nobody).
 * Every other protection applies in both modes: 3 open asks, one edited resend a week, rate limits, the compiler.
 */
export function realAskersMode(raw: string | undefined = process.env.REAL_ASKERS): 'open' | 'allowlist' {
  const v = (raw ?? '').trim();
  return v === '' || v === '*' ? 'open' : 'allowlist';
}
export const REAL_ASKERS_MODE: 'open' | 'allowlist' = realAskersMode();

/** Exposed for tests only: parse an arbitrary environment object with the same rules. */
export const __parseEnvForTests = parseEnv;
