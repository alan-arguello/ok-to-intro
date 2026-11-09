/**
 * A small supabase-js stand-in backed by PGlite (tests/db/harness.ts), for S3's server tests. It implements the
 * subset of the query builder lib/server/member.ts and lib/server/api-tokens.ts use (select / insert / upsert /
 * update / delete with eq, neq, is, not-is, in, gte, gt, lt, lte, order, limit, single, maybeSingle; rpc;
 * auth.admin.deleteUser) and runs every statement as `service_role`, the way the admin client does, so the real
 * migration's constraints, triggers, functions and grants apply. Results follow PostgREST's shapes: timestamps as
 * ISO strings, dates as YYYY-MM-DD, `{ data, error: { message, code } }`, PGRST116 for single() misses.
 */

import type { TestDb } from '../db/harness';

type Row = Record<string, unknown>;
type PgError = { message: string; code: string; details: string | null; hint: string | null };
type Result = { data: unknown; error: PgError | null; count?: number | null; status: number };

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`fake-supabase: bad identifier ${name}`);
  return `"${name}"`;
}

function columns(cols: string | undefined): string {
  if (!cols || cols.trim() === '*') return '*';
  return cols
    .split(',')
    .map((c) => ident(c.trim()))
    .join(', ');
}

// PGlite type OIDs: date, timestamp, timestamptz, int8, numeric
const DATE = 1082;
const TIMESTAMP = 1114;
const TIMESTAMPTZ = 1184;
const INT8 = 20;
const NUMERIC = 1700;

function normalize(rows: Row[], fields: { name: string; dataTypeID: number }[]): Row[] {
  return rows.map((r) => {
    const out: Row = { ...r };
    for (const f of fields) {
      const v = out[f.name];
      if (v === null || v === undefined) continue;
      if ((f.dataTypeID === TIMESTAMPTZ || f.dataTypeID === TIMESTAMP) && v instanceof Date) out[f.name] = v.toISOString();
      else if (f.dataTypeID === DATE && v instanceof Date) out[f.name] = v.toISOString().slice(0, 10);
      else if (f.dataTypeID === DATE && typeof v === 'string') out[f.name] = v.slice(0, 10);
      else if (f.dataTypeID === INT8 && typeof v === 'bigint') out[f.name] = Number(v);
      else if (f.dataTypeID === NUMERIC && typeof v === 'string') out[f.name] = Number(v);
    }
    return out;
  });
}

function toPgError(err: unknown): PgError {
  const e = err as { message?: string; code?: string; detail?: string; hint?: string };
  return { message: e.message ?? String(err), code: e.code ?? '', details: e.detail ?? null, hint: e.hint ?? null };
}

function param(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(v);
  return v;
}

type Filter = { sql: (p: (v: unknown) => string) => string };

class Query implements PromiseLike<Result> {
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private cols: string | undefined = '*';
  private returning = false;
  private values: Row | Row[] | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private filters: Filter[] = [];
  private orders: string[] = [];
  private limitN: number | null = null;
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(
    private readonly fake: FakeSupabase,
    private readonly table: string,
  ) {
    ident(table);
  }

  select(cols = '*') {
    if (this.op === 'select') this.cols = cols;
    else {
      this.returning = true;
      this.cols = cols;
    }
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = 'insert';
    this.values = values;
    return this;
  }
  upsert(values: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) {
    this.op = 'upsert';
    this.values = values;
    this.upsertOpts = opts;
    return this;
  }
  update(values: Row) {
    this.op = 'update';
    this.values = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  private cmp(col: string, op: string, v: unknown) {
    this.filters.push({ sql: (p) => `${ident(col)} ${op} ${p(v)}` });
    return this;
  }
  eq(col: string, v: unknown) {
    return this.cmp(col, '=', v);
  }
  neq(col: string, v: unknown) {
    return this.cmp(col, '<>', v);
  }
  gt(col: string, v: unknown) {
    return this.cmp(col, '>', v);
  }
  gte(col: string, v: unknown) {
    return this.cmp(col, '>=', v);
  }
  lt(col: string, v: unknown) {
    return this.cmp(col, '<', v);
  }
  lte(col: string, v: unknown) {
    return this.cmp(col, '<=', v);
  }
  in(col: string, list: unknown[]) {
    this.filters.push({ sql: (p) => `${ident(col)} = any(${p(list)})` });
    return this;
  }
  is(col: string, v: null | boolean) {
    this.filters.push({ sql: () => `${ident(col)} is ${v === null ? 'null' : v ? 'true' : 'false'}` });
    return this;
  }
  not(col: string, op: string, v: unknown) {
    if (op !== 'is') throw new Error(`fake-supabase: not(${op}) unsupported`);
    this.filters.push({ sql: () => `${ident(col)} is not ${v === null ? 'null' : v ? 'true' : 'false'}` });
    return this;
  }
  order(col: string, opts: { ascending?: boolean } = {}) {
    this.orders.push(`${ident(col)} ${opts.ascending === false ? 'desc' : 'asc'}`);
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  abortSignal(_signal: AbortSignal) {
    return this;
  }
  single() {
    this.mode = 'single';
    return this;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this;
  }

  private build(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(param(v));
      return `$${params.length}`;
    };
    const where = this.filters.length ? ` where ${this.filters.map((f) => f.sql(p)).join(' and ')}` : '';
    const t = `public.${ident(this.table)}`;
    const ret = this.returning ? ` returning ${columns(this.cols)}` : ' returning *';
    switch (this.op) {
      case 'select': {
        const order = this.orders.length ? ` order by ${this.orders.join(', ')}` : '';
        const limit = this.limitN !== null ? ` limit ${Number(this.limitN)}` : '';
        return { sql: `select ${columns(this.cols)} from ${t}${where}${order}${limit}`, params };
      }
      case 'insert':
      case 'upsert': {
        const rows = Array.isArray(this.values) ? this.values : [this.values as Row];
        const keys = Object.keys(rows[0] ?? {});
        const vals = rows.map((r) => `(${keys.map((k) => p(r[k])).join(', ')})`).join(', ');
        let conflict = '';
        if (this.op === 'upsert') {
          const target = (this.upsertOpts.onConflict ?? 'id')
            .split(',')
            .map((c) => ident(c.trim()))
            .join(', ');
          conflict = this.upsertOpts.ignoreDuplicates
            ? ` on conflict (${target}) do nothing`
            : ` on conflict (${target}) do update set ${keys.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ')}`;
        }
        return { sql: `insert into ${t} (${keys.map(ident).join(', ')}) values ${vals}${conflict}${ret}`, params };
      }
      case 'update': {
        const set = Object.entries(this.values as Row)
          .map(([k, v]) => `${ident(k)} = ${p(v)}`)
          .join(', ');
        return { sql: `update ${t} set ${set}${where}${ret}`, params };
      }
      case 'delete':
        return { sql: `delete from ${t}${where}${ret}`, params };
    }
  }

  async execute(): Promise<Result> {
    if (this.fake.down) return { data: null, error: { message: 'TypeError: fetch failed', code: '', details: null, hint: null }, status: 0 };
    const { sql, params } = this.build();
    try {
      const res = await this.fake.db.asService((tx) => tx.query<Row>(sql, params));
      const rows = normalize(res.rows, res.fields as { name: string; dataTypeID: number }[]);
      this.fake.log.push({ table: this.table, op: this.op });
      const wantsRows = this.op === 'select' || this.returning;
      if (!wantsRows) return { data: null, error: null, status: 204 };
      if (this.mode === 'single') {
        if (rows.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: null, hint: null }, status: 406 };
        return { data: rows[0], error: null, status: 200 };
      }
      if (this.mode === 'maybe') {
        if (rows.length > 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116', details: null, hint: null }, status: 406 };
        return { data: rows[0] ?? null, error: null, status: 200 };
      }
      return { data: rows, error: null, status: 200 };
    } catch (err) {
      return { data: null, error: toPgError(err), status: 400 };
    }
  }

  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class Rpc implements PromiseLike<Result> {
  constructor(
    private readonly fake: FakeSupabase,
    private readonly fn: string,
    private readonly args: Row,
  ) {
    ident(fn);
  }
  abortSignal(_signal: AbortSignal) {
    return this;
  }
  async execute(): Promise<Result> {
    if (this.fake.down) return { data: null, error: { message: 'TypeError: fetch failed', code: '', details: null, hint: null }, status: 0 };
    const params: unknown[] = [];
    const named = Object.entries(this.args)
      .map(([k, v]) => {
        params.push(param(v));
        return `${ident(k)} => $${params.length}`;
      })
      .join(', ');
    try {
      const res = await this.fake.db.asService((tx) => tx.query<Row>(`select * from public.${ident(this.fn)}(${named})`, params));
      const rows = normalize(res.rows, res.fields as { name: string; dataTypeID: number }[]);
      this.fake.log.push({ table: this.fn, op: 'rpc' });
      const fields = res.fields as { name: string }[];
      if (fields.length === 1 && fields[0]?.name === this.fn) return { data: rows[0]?.[this.fn] ?? null, error: null, status: 200 };
      return { data: rows, error: null, status: 200 };
    } catch (err) {
      return { data: null, error: toPgError(err), status: 400 };
    }
  }
  then<A = Result, B = never>(onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class FakeSupabase {
  /** Simulates an unreachable database: every call returns `fetch failed` (isDbDown → true). */
  down = false;
  readonly log: { table: string; op: string }[] = [];

  constructor(readonly db: TestDb) {}

  from(table: string) {
    return new Query(this, table);
  }

  rpc(fn: string, args: Row = {}) {
    return new Rpc(this, fn, args);
  }

  readonly auth = {
    admin: {
      deleteUser: async (id: string) => {
        if (this.down) return { data: null, error: { message: 'fetch failed', status: 0 } };
        const r = await this.db.pg.query<{ id: string }>('delete from auth.users where id = $1 returning id', [id]);
        if (!r.rows.length) return { data: null, error: { message: 'User not found', status: 404, code: 'user_not_found' } };
        return { data: {}, error: null };
      },
    },
  };
}
