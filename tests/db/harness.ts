/**
 * PGlite test database with the Supabase pieces our migrations rely on, then every migration in order.
 *
 * Emulated (as Supabase sets them up):
 * - roles anon, authenticated, service_role (service_role bypasses RLS);
 * - schema auth with auth.users, auth.uid() (reads the `request.jwt.claim.sub` GUC, like Supabase),
 *   auth.role() and auth.jwt();
 * - default privileges: new tables, sequences and functions in public are granted to all three roles, so the
 *   migration's own revokes and RLS are what protects data (exactly the production situation).
 *
 * Usage (any owner's tests may import this file; it is frozen with the foundation):
 *   const db = await createTestDb();
 *   const priya = await db.createUser('priya@example.com');
 *   await db.asService((tx) => tx.query('select public.reserve_slot($1)', [priya]));
 *   const rows = await db.asUser(priya, (tx) => tx.query('select * from public.members'));
 *   await db.close();
 *
 * PGlite is one connection in WASM: it proves logic, constraints and RLS, not concurrency. The cap race test
 * (scripts/race-test.ts) runs against a real Supabase Postgres through supabase-js RPC (no extra driver).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type Transaction } from '@electric-sql/pglite';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));

export const SUPABASE_PRELUDE = `
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant all on auth.users to service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

export type Tx = Transaction;

export interface TestDb {
  /** The raw PGlite instance (runs as the `postgres` superuser, like a migration). */
  pg: PGlite;
  /** Creates an auth user and returns its id. */
  createUser(email: string): Promise<string>;
  /** Creates an auth user plus a member row (status `on`) with rules, as the service role would. */
  createMember(email: string, options?: { rules?: string; cap?: number; status?: 'pending' | 'on' | 'paused' }): Promise<string>;
  /** Runs `fn` in a transaction as `authenticated` with auth.uid() = userId. */
  asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Runs `fn` in a transaction as `anon`. */
  asAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Runs `fn` in a transaction as `service_role` (bypasses RLS). */
  asService<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Migration files in apply order (0001_init.sql, 0002_*.sql, …). */
export function migrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export async function createTestDb(options: { migrations?: string[] } = {}): Promise<TestDb> {
  const pg = new PGlite();
  await pg.exec(SUPABASE_PRELUDE);
  for (const file of options.migrations ?? migrationFiles()) {
    try {
      await pg.exec(readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function asRole<T>(role: 'anon' | 'authenticated' | 'service_role', sub: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return pg.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [sub ?? '', role]);
      await tx.exec(`set local role ${role}`);
      return fn(tx);
    });
  }

  return {
    pg,
    async createUser(email) {
      const r = await pg.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
      return (r.rows[0] as { id: string }).id;
    },
    async createMember(email, opts = {}) {
      const r = await pg.query<{ id: string }>('insert into auth.users (email) values ($1) returning id', [email]);
      const id = (r.rows[0] as { id: string }).id;
      await pg.query('insert into public.members (id, email, cap, status) values ($1, $2, $3, $4)', [id, email.toLowerCase(), opts.cap ?? 2, opts.status ?? 'on']);
      if (opts.rules !== undefined) await pg.query('select public.save_rules($1, $2, $3)', [id, opts.rules, 'web']);
      return id;
    },
    asUser: (userId, fn) => asRole('authenticated', userId, fn),
    asAnon: (fn) => asRole('anon', null, fn),
    asService: (fn) => asRole('service_role', null, fn),
    close: () => pg.close(),
  };
}
