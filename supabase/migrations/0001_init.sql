-- OK to Intro · 0001_init.sql · foundation schema (owner: F; frozen during the build; later changes go in 0002_*.sql)
--
-- Every table has RLS on. anon gets nothing. authenticated users may only read a few of their own rows; they can't
-- write anything directly. The server writes with the service role (bypasses RLS) and every write path checks
-- ownership in code. Askers never read `asks` directly: everything they see goes through the asker serializer
-- (docs/CONTRACT.md §d), because raw columns (status, close_reason, updated_at) would date a member's No.
-- Facts the public board counts live in `audit`, which survives member deletion (ids there are set null),
-- so “Board counts stay, without your name” (ux-spec S3) holds.
--
-- Time: cap months are calendar months in America/Los_Angeles (public.cap_month). Timestamps are timestamptz.
-- Ids: public ids are short text with a type prefix (a_, o_, q_, i_, c_, t_), minted by lib/oti/ids.ts.

-- ============================================================================================================
-- Helpers
-- ============================================================================================================

-- First day of the cap month in Pacific time for an instant.
create or replace function public.cap_month(ts timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', ts at time zone 'America/Los_Angeles')::date
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ============================================================================================================
-- Members, rules, caps
-- ============================================================================================================

create table public.members (
  id              uuid primary key references auth.users (id) on delete cascade,
  email           text not null check (email = lower(email) and email like '%_@_%'),
  name            text not null default '' check (char_length(name) <= 80),
  one_line        text not null default '' check (char_length(one_line) <= 140),
  -- Asker profile (shown on REAL asks): company, stage, city.
  company         text not null default '' check (char_length(company) <= 80),
  stage           text not null default '' check (char_length(stage) <= 40),
  city            text not null default '' check (char_length(city) <= 60),
  scheduling_url  text check (scheduling_url is null or (scheduling_url ~ '^https://[^\s]+$' and char_length(scheduling_url) <= 200)),
  cap             smallint not null default 2 check (cap between 1 and 5),
  show_matched    boolean not null default false,
  accept_guests   boolean not null default false,
  -- pending: joined, gate not turned on yet. paused: no new offers until paused_until (null = until turned back on).
  status          text not null default 'pending' check (status in ('pending', 'on', 'paused')),
  paused_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status = 'paused' or paused_until is null)
);
create unique index members_email_key on public.members (email);
create trigger members_touch before update on public.members for each row execute function public.touch_updated_at();

-- True when the member's gate takes new asks now (a timed pause ends by itself).
create or replace function public.member_is_active(m public.members, at_ts timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select m.status = 'on' or (m.status = 'paused' and m.paused_until is not null and m.paused_until <= at_ts)
$$;

-- Every saved version of a member's rules. Decisions record the version they read.
create table public.rule_versions (
  member_id   uuid not null references public.members (id) on delete cascade,
  version     integer not null check (version > 0),
  text        text not null check (char_length(text) between 1 and 1000),
  source      text not null default 'web' check (source in ('web', 'playground', 'offer_edit', 'mcp')),
  created_at  timestamptz not null default now(),
  primary key (member_id, version)
);

-- The current rules (one row per member), always pointing at a saved version.
create table public.rules (
  member_id   uuid primary key references public.members (id) on delete cascade,
  version     integer not null,
  text        text not null check (char_length(text) between 1 and 1000),
  updated_at  timestamptz not null default now(),
  foreign key (member_id, version) references public.rule_versions (member_id, version)
);

-- Saves a new version and makes it current, atomically. Returns the new version number.
-- Callable by the service role, or by an authenticated member for their own rules.
create or replace function public.save_rules(p_member uuid, p_text text, p_source text default 'web')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next integer;
begin
  if auth.uid() is not null and auth.uid() <> p_member then
    raise exception 'not your rules' using errcode = '42501';
  end if;
  if p_text is null or char_length(btrim(p_text)) = 0 or char_length(p_text) > 1000 then
    raise exception 'rules must be 1 to 1000 characters' using errcode = '22023';
  end if;
  -- Serialise concurrent saves for one member.
  perform 1 from public.members where id = p_member for update;
  if not found then
    raise exception 'no such member' using errcode = '23503';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.rule_versions where member_id = p_member;
  insert into public.rule_versions (member_id, version, text, source) values (p_member, v_next, p_text, p_source);
  insert into public.rules (member_id, version, text, updated_at)
    values (p_member, v_next, p_text, now())
    on conflict (member_id) do update set version = excluded.version, text = excluded.text, updated_at = now();
  return v_next;
end
$$;

-- Offers delivered per member per cap month. A row is created on first use.
create table public.cap_usage (
  member_id   uuid not null references public.members (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  used        integer not null default 0 check (used >= 0),
  updated_at  timestamptz not null default now(),
  primary key (member_id, month)
);

-- Takes one slot of the member's monthly cap, or doesn't. Creates the counter row if missing, row-locks it,
-- compares with the member's cap in the same transaction, and returns whether it took a slot.
-- Two asks racing for the last slot serialise on the row lock: exactly one gets true.
create or replace function public.reserve_slot(p_member uuid, p_month date default public.cap_month())
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap  smallint;
  v_used integer;
begin
  if extract(day from p_month) <> 1 then
    raise exception 'month must be the first day of a month' using errcode = '22023';
  end if;
  insert into public.cap_usage (member_id, month, used) values (p_member, p_month, 0)
    on conflict (member_id, month) do nothing;
  select used into v_used from public.cap_usage where member_id = p_member and month = p_month for update;
  select cap into v_cap from public.members where id = p_member;
  if v_cap is null or v_used >= v_cap then
    return false;
  end if;
  update public.cap_usage set used = used + 1, updated_at = now() where member_id = p_member and month = p_month;
  return true;
end
$$;

-- ============================================================================================================
-- Asks, the members each ask was checked against, gate decisions, questions
-- ============================================================================================================

-- Who may ask the REAL network (seeded from REAL_ASKERS by the server; Alan adds invited founders).
create table public.real_askers (
  email     text primary key check (email = lower(email)),
  source    text not null default 'env' check (source in ('env', 'admin')),
  added_at  timestamptz not null default now()
);

create table public.asks (
  id               text primary key check (id ~ '^a_[0-9A-Za-z]{3,16}$'),
  asker_id         uuid not null references public.members (id) on delete cascade,
  network          text not null default 'real' check (network in ('real', 'sample')),
  raw              text not null check (char_length(raw) between 1 and 600),
  compiled         jsonb not null check (jsonb_typeof(compiled) = 'object'),
  subject          text not null check (char_length(subject) between 1 and 45),
  -- ready: created, not sent yet (POST /api/asks/[id]/send sends it). queued: the asker already has 3 open asks.
  status           text not null default 'ready'
                   check (status in ('ready', 'queued', 'gating', 'open', 'answered', 'intro', 'no_match', 'closed', 'failed', 'withdrawn')),
  -- An edited resend of an earlier ask (“Edit and resend”): at most one a week per original (BE2 enforces).
  resend_of        text references public.asks (id) on delete set null,
  close_reason     text check (close_reason in ('all_passed', 'deadline', 'solved', 'answer_timeout', 'asker_closed')),
  deadline         date,
  -- Members in the network when the fan-out ran (the waffle size).
  network_size     integer check (network_size >= 0),
  idempotency_key  text check (char_length(idempotency_key) <= 128),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,
  -- When the send finished streaming: the asker's view reflects at least this moment (lib/oti/time askerAsOf).
  gated_at         timestamptz,
  closed_at        timestamptz,
  withdrawn_at     timestamptz,
  updated_at       timestamptz not null default now(),
  unique (asker_id, idempotency_key)
);
create index asks_asker_created on public.asks (asker_id, created_at desc);
-- Open asks count toward the 3-open-asks limit (ready ones are about to send).
create index asks_open on public.asks (asker_id, status) where status in ('ready', 'queued', 'gating', 'open', 'answered');
create index asks_resend_of on public.asks (resend_of) where resend_of is not null;
create trigger asks_touch before update on public.asks for each row execute function public.touch_updated_at();

-- One row per member in the network when an ask fanned out: its fixed waffle position and, if SQL dropped the
-- member before any model call, why.
create table public.ask_members (
  ask_id      text not null references public.asks (id) on delete cascade,
  member_id   uuid not null references public.members (id) on delete cascade,
  position    integer not null check (position >= 0),
  skip        text check (skip in ('at_cap', 'paused', 'repeat_pair', 'self')),
  created_at  timestamptz not null default now(),
  primary key (ask_id, member_id),
  unique (ask_id, position)
);
create index ask_members_member on public.ask_members (member_id);

-- ask_back questions, deduplicated by type per ask (“Your answer goes only to the gates that asked (2)”).
create table public.questions (
  id           text primary key check (id ~ '^q_[0-9A-Za-z]{3,16}$'),
  ask_id       text not null references public.asks (id) on delete cascade,
  type         text not null check (type in ('price', 'deal_size', 'buyer_count', 'stage', 'region', 'timeline', 'role', 'metric')),
  text         text not null check (char_length(text) between 1 and 100 and text !~* '(https?://|www\.|[^\s@]+@[^\s@]+\.)'),
  gates        integer not null default 1 check (gates >= 1),
  answer       text check (answer is null or char_length(answer) between 1 and 280),
  answered_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (ask_id, type),
  check ((answer is null) = (answered_at is null))
);

create table public.gate_decisions (
  id               bigint generated always as identity primary key,
  ask_id           text not null references public.asks (id) on delete cascade,
  member_id        uuid not null references public.members (id) on delete cascade,
  -- 1 = the fan-out; 2 = the one rerun after the asker answered a question.
  attempt          smallint not null default 1 check (attempt in (1, 2)),
  rules_version    integer not null,
  -- Final verdict after code checks. Null only when the gate failed (not checked).
  verdict          text check (verdict in ('accept', 'decline', 'ask_back')),
  -- What the model returned before code checks.
  model_verdict    text check (model_verdict in ('accept', 'decline', 'ask_back')),
  -- [{text, found, start, end}] after the clause check; offsets index rule_versions.text.
  cited            jsonb not null default '[]'::jsonb check (jsonb_typeof(cited) = 'array'),
  decided_by       text check (decided_by in ('gate', 'clause_check')),
  clause_verified  boolean not null default false,
  reason_code      text check (reason_code in ('match', 'no_rule', 'rule_says_no', 'stage', 'proof', 'topic', 'region')),
  reason           text check (char_length(reason) <= 500),
  question         jsonb check (question is null or jsonb_typeof(question) = 'object'),
  question_id      text references public.questions (id) on delete set null,
  flags            text[] not null default '{}' check (flags <@ array['instruction_in_ask', 'asker_not_founder']::text[]),
  confidence       real check (confidence is null or (confidence >= 0 and confidence <= 1)),
  error_kind       text check (error_kind in ('timeout', 'rate_limited', 'overloaded', 'refused', 'budget', 'parse', 'unavailable')),
  latency_ms       integer check (latency_ms >= 0),
  model            text,
  source           text not null default 'live' check (source in ('live', 'recorded')),
  request_id       text,
  cost_usd         numeric(10, 6) check (cost_usd >= 0),
  created_at       timestamptz not null default now(),
  unique (ask_id, member_id, attempt),
  -- A refusal or an unparseable answer is a decline by code; other failures leave no verdict (not checked).
  check (verdict is not null or error_kind is not null),
  check (error_kind is null or error_kind in ('refused', 'parse') or verdict is null),
  check (error_kind not in ('refused', 'parse') or verdict = 'decline'),
  -- A failed clause check is always a decline.
  check (decided_by is distinct from 'clause_check' or verdict = 'decline'),
  foreign key (ask_id, member_id) references public.ask_members (ask_id, member_id) on delete cascade
);
create index gate_decisions_member_created on public.gate_decisions (member_id, created_at desc);

-- ============================================================================================================
-- Offers (one card to one member at a time), intros, check-ins
-- ============================================================================================================

create table public.offers (
  id               text primary key check (id ~ '^o_[0-9A-Za-z]{3,16}$'),
  ask_id           text not null references public.asks (id) on delete cascade,
  member_id        uuid not null references public.members (id) on delete cascade,
  -- HMAC of the opaque link token (lib/oti/tokens.ts). The token itself is never stored.
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- 1 = first in line, 2 = next after a pass or expiry, …
  position         smallint not null default 1 check (position >= 1),
  -- The cap month the slot came from (counted at delivery, whatever the answer).
  month            date not null check (extract(day from month) = 1),
  state            text not null default 'pending' check (state in ('pending', 'ok', 'answered', 'passed', 'expired', 'withdrawn')),
  offered_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  responded_at     timestamptz,
  answer           text check (answer is null or (char_length(answer) between 1 and 280 and array_length(string_to_array(answer, E'\n'), 1) <= 3)),
  no_reason        text check (no_reason in ('not_my_area', 'wrong_stage', 'not_specific', 'no_time', 'other')),
  no_note          text check (char_length(no_note) <= 140),
  -- The idempotency key of the POST that moved it out of pending (token + action).
  idempotency_key  text check (char_length(idempotency_key) <= 128),
  created_at       timestamptz not null default now(),
  unique (ask_id, member_id),
  check (expires_at = offered_at + interval '72 hours'),
  check ((state = 'pending') = (responded_at is null)),
  check (state = 'answered' or answer is null),
  check (state = 'passed' or (no_reason is null and no_note is null))
);
-- At most one person holds an ask at a time.
create unique index offers_one_pending_per_ask on public.offers (ask_id) where state = 'pending';
create index offers_member_state on public.offers (member_id, state);
create index offers_pending_expiry on public.offers (expires_at) where state = 'pending';

-- The offer state machine: pending → ok | answered | passed | expired | withdrawn. Terminal states never change,
-- except that a pass may gain its optional reason later.
create or replace function public.offers_state_machine()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state = 'pending' then
    if new.state not in ('pending', 'ok', 'answered', 'passed', 'expired', 'withdrawn') then
      raise exception 'bad offer state %', new.state using errcode = '22023';
    end if;
    if new.state <> 'pending' and new.responded_at is null then
      new.responded_at := now();
    end if;
  elsif new.state <> old.state then
    raise exception 'offer % is already %', old.id, old.state using errcode = '55000';
  elsif row(new.answer, new.responded_at, new.expires_at, new.offered_at, new.member_id, new.ask_id, new.month, new.position)
        is distinct from row(old.answer, old.responded_at, old.expires_at, old.offered_at, old.member_id, old.ask_id, old.month, old.position) then
    raise exception 'offer % is final', old.id using errcode = '55000';
  elsif old.state <> 'passed' and (new.no_reason is distinct from old.no_reason or new.no_note is distinct from old.no_note) then
    raise exception 'offer % is final', old.id using errcode = '55000';
  end if;
  -- The one later change a final offer allows: the optional “Why?” after a pass (no_reason, no_note).
  return new;
end
$$;
create trigger offers_state before update on public.offers for each row execute function public.offers_state_machine();

-- Creates an offer only if the member's monthly cap has a free slot (reserve_slot), in one transaction.
-- Outcomes (BE2's advance loop depends on telling them apart):
--   one row          the new offer (the slot was taken at delivery, whatever the answer will be);
--   no row           THIS member can't take it now (cap full, paused, gate not on): try the next person in line;
--   error OTI01      someone already holds the ask: stop, another request advanced it;
--   error OTI02      the ask isn't open for offers (status not gating/open: withdrawn, closed, answered, intro…): stop.
create or replace function public.create_offer(
  p_offer_id   text,
  p_ask_id     text,
  p_member     uuid,
  p_token_hash text,
  p_position   smallint default 1,
  p_at         timestamptz default now()
)
returns setof public.offers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month  date := public.cap_month(p_at);
  v_status text;
  v_member public.members;
begin
  -- Lock the ask so two dispatchers can't both offer it.
  select status into v_status from public.asks where id = p_ask_id for update;
  if not found then
    raise exception 'no such ask' using errcode = '23503';
  end if;
  if v_status not in ('gating', 'open') then
    raise exception 'ask % is %, not open for offers', p_ask_id, v_status using errcode = 'OTI02';
  end if;
  if exists (select 1 from public.offers where ask_id = p_ask_id and state = 'pending') then
    raise exception 'ask % is already held', p_ask_id using errcode = 'OTI01';
  end if;
  select * into v_member from public.members where id = p_member;
  if not found or not public.member_is_active(v_member, p_at) then
    return;
  end if;
  if not public.reserve_slot(p_member, v_month) then
    return;
  end if;
  return query
    insert into public.offers (id, ask_id, member_id, token_hash, position, month, offered_at, expires_at)
    values (p_offer_id, p_ask_id, p_member, p_token_hash, p_position, v_month, p_at, p_at + interval '72 hours')
    returning *;
end
$$;

-- Moves every pending offer past its 72 hours to expired (lazily on read, and by the daily sweep).
create or replace function public.expire_due_offers(p_now timestamptz default now())
returns setof public.offers
language sql
security definer
set search_path = ''
as $$
  update public.offers set state = 'expired', responded_at = expires_at
  where state = 'pending' and expires_at <= p_now
  returning *
$$;

create table public.intros (
  id          text primary key check (id ~ '^i_[0-9A-Za-z]{3,16}$'),
  ask_id      text not null unique references public.asks (id) on delete cascade,
  offer_id    text not null unique references public.offers (id) on delete cascade,
  member_id   uuid not null references public.members (id) on delete cascade,
  asker_id    uuid not null references public.members (id) on delete cascade,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index intros_member on public.intros (member_id);
create index intros_asker on public.intros (asker_id);

create table public.checkins (
  id             text primary key check (id ~ '^c_[0-9A-Za-z]{3,16}$'),
  intro_id       text not null references public.intros (id) on delete cascade,
  -- The person asked (the asker or the member).
  member_id      uuid not null references public.members (id) on delete cascade,
  role           text not null check (role in ('asker', 'member')),
  kind           text not null check (kind in ('d1', 'd14')),
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  due_at         timestamptz not null,
  sent_at        timestamptz,
  -- Resend scheduled-send id, cancelled on pause or delete.
  email_id       text,
  -- d1: {rating:1..5} | {not_yet:true} | {wont_happen:true, reason} ; d14: {outcome, note}
  answer         jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  answered_at    timestamptz,
  -- d1 “We haven't talked yet” schedules one reminder.
  reminder_at    timestamptz,
  closes_at      timestamptz not null,
  created_at     timestamptz not null default now(),
  unique (intro_id, role, kind),
  check ((answer is null) = (answered_at is null)),
  check (closes_at > due_at)
);
create index checkins_member on public.checkins (member_id);
create index checkins_due on public.checkins (due_at) where sent_at is null;

-- ============================================================================================================
-- Tokens, limits, email outbox, audit
-- ============================================================================================================

-- Claude Code tokens (shown once; only the HMAC is kept). One active token per member.
create table public.api_tokens (
  id              text primary key check (id ~ '^t_[0-9A-Za-z]{3,16}$'),
  member_id       uuid not null references public.members (id) on delete cascade,
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label           text not null default 'Claude Code' check (char_length(label) <= 40),
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  last_used_from  text check (char_length(last_used_from) <= 40),
  revoked_at      timestamptz
);
create unique index api_tokens_one_active on public.api_tokens (member_id) where revoked_at is null;

-- “Pause all asks” links in emails and List-Unsubscribe (no sign-in). A token can pause, and can undo the pause it
-- made itself within 24 hours (the /pause page's Undo): it restores undo_status / undo_paused_until, nothing else.
create table public.pause_tokens (
  token_hash         text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  member_id          uuid not null references public.members (id) on delete cascade,
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  -- Set when this token paused the member: when, and the member's state just before (for Undo).
  paused_at          timestamptz,
  undo_status        text check (undo_status in ('pending', 'on', 'paused')),
  undo_paused_until  timestamptz
);
create index pause_tokens_member on public.pause_tokens (member_id);

-- Per-key fixed windows. key = HMAC(ip, daily salt) or a member id; never a raw IP.
create table public.rate_limits (
  key           text not null check (char_length(key) <= 64),
  bucket        text not null check (bucket in ('try', 'compile', 'send', 'sample_send', 'mcp', 'pages', 'otp')),
  window_start  timestamptz not null,
  count         integer not null default 0 check (count >= 0),
  primary key (key, bucket, window_start)
);

-- Counts one hit and says whether it is allowed (fixed window of p_window_s seconds).
create or replace function public.hit_rate_limit(p_key text, p_bucket text, p_window_s integer, p_limit integer)
returns table (allowed boolean, hits integer, retry_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);
  v_count integer;
begin
  insert into public.rate_limits (key, bucket, window_start, count) values (p_key, p_bucket, v_start, 1)
    on conflict (key, bucket, window_start) do update set count = public.rate_limits.count + 1
    returning count into v_count;
  return query select v_count <= p_limit, v_count, v_start + make_interval(secs => p_window_s);
end
$$;

-- Emails, keyed by their idempotency key (offer:<id>, intro:<id>, checkin1:<id>, …). The cron retries failures.
create table public.email_outbox (
  key          text primary key check (char_length(key) <= 128),
  kind         text not null check (kind in ('offer', 'intro', 'checkin', 'question', 'outcome_note', 'withdrawn')),
  member_id    uuid references public.members (id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued', 'scheduled', 'sent', 'failed', 'cancelled')),
  send_at      timestamptz not null default now(),
  resend_id    text,
  attempts     integer not null default 0,
  last_error   text check (char_length(last_error) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index email_outbox_due on public.email_outbox (send_at) where status in ('queued', 'failed');
create index email_outbox_member on public.email_outbox (member_id) where status in ('queued', 'scheduled');
create trigger email_outbox_touch before update on public.email_outbox for each row execute function public.touch_updated_at();

-- MCP drafts (draft_ask → draft_ask with draft_id → send_ask with draft_id). mcp-handler is stateless, so the
-- draft lives here between calls. Open SAMPLE drafts have no owner; drafts expire after 24 hours (the daily cron
-- deletes them). Server only.
create table public.drafts (
  id          text primary key check (id ~ '^d_[0-9A-Za-z]{3,16}$'),
  -- The member whose token drafted it, or null for an open (no token) SAMPLE draft.
  owner_id    uuid references public.members (id) on delete cascade,
  network     text not null default 'sample' check (network in ('sample', 'real')),
  raw         text not null check (char_length(raw) between 1 and 600),
  -- lib/types CompiledPart[]: what the compiler returned, then completed by the user's answers.
  parts       jsonb not null default '[]'::jsonb check (jsonb_typeof(parts) = 'array'),
  subject     text check (subject is null or char_length(subject) between 1 and 45),
  topic       text check (topic is null or char_length(topic) <= 80),
  state       text not null default 'missing' check (state in ('missing', 'ready', 'refused', 'sent')),
  -- The ask it became (a_… on REAL, sa_… on SAMPLE), once sent.
  ask_id      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '24 hours')
);
create index drafts_expires on public.drafts (expires_at);
create trigger drafts_touch before update on public.drafts for each row execute function public.touch_updated_at();

-- Model spend per local day in Pacific time, across every server instance: the app-level daily budget
-- (DAILY_BUDGET_USD) is checked against this before live calls. Server only.
create table public.model_usage (
  day         date primary key,
  usd         numeric(12, 6) not null default 0 check (usd >= 0),
  calls       integer not null default 0 check (calls >= 0),
  updated_at  timestamptz not null default now()
);

-- Adds measured usage and returns the day's total in USD (one statement, safe under concurrency).
create or replace function public.add_model_usage(p_usd numeric, p_calls integer default 1, p_at timestamptz default now())
returns numeric
language sql
security definer
set search_path = ''
as $$
  insert into public.model_usage as u (day, usd, calls, updated_at)
  values ((p_at at time zone 'America/Los_Angeles')::date, greatest(coalesce(p_usd, 0), 0), greatest(coalesce(p_calls, 0), 0), now())
  on conflict (day) do update set usd = u.usd + excluded.usd, calls = u.calls + excluded.calls, updated_at = now()
  returning usd
$$;

-- What the SessionStart hook already showed a member (ux-spec S6: each item at most twice, when it arrives and when
-- under 24 h remain). item = 'offer:o_…' | 'question:q_…' | 'checkin:c_…'. Server only.
create table public.hook_seen (
  member_id      uuid not null references public.members (id) on delete cascade,
  item           text not null check (char_length(item) <= 64),
  shown          smallint not null default 0 check (shown between 0 and 2),
  last_shown_at  timestamptz,
  primary key (member_id, item)
);

-- Small shared state for server instances, e.g. key 'live_pause' = {"state": "budget", "until": "…"} when
-- Anthropic reports a spend limit (BE1). Server only; never holds secrets, rules, asks or personal data.
create table public.app_state (
  key         text primary key check (char_length(key) <= 64),
  value       jsonb not null default '{}'::jsonb check (jsonb_typeof(value) = 'object'),
  updated_at  timestamptz not null default now()
);

-- Append-only facts. The public board counts these. Member references become null when a member deletes their
-- data; ask and offer ids are plain text (no foreign keys), so the counts survive.
create table public.audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  action      text not null check (action in (
    'member_joined', 'member_gate_on', 'member_paused', 'member_resumed', 'member_deleted', 'rules_saved',
    'compile_refused', 'ask_sent', 'ask_withdrawn', 'ask_closed', 'ask_no_match', 'ask_failed_closed',
    'gate_checked', 'question_answered',
    'offer_delivered', 'offer_ok', 'offer_answered', 'offer_passed', 'offer_expired', 'offer_withdrawn',
    'intro_made', 'checkin_answered',
    'playground_run', 'sample_ask_sent', 'token_created', 'token_revoked'
  )),
  actor_id    uuid references public.members (id) on delete set null,
  member_id   uuid references public.members (id) on delete set null,
  asker_id    uuid references public.members (id) on delete set null,
  ask_id      text,
  offer_id    text,
  -- Facts only (verdicts, counts, latencies, ratings). Never rules text, ask text, names or emails.
  detail      jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index audit_action_at on public.audit (action, at);
create index audit_ask on public.audit (ask_id) where ask_id is not null;

-- ============================================================================================================
-- Eval (held-out cases are frozen before tuning; runs are append-only)
-- ============================================================================================================

create table public.eval_cases (
  id            text primary key check (char_length(id) <= 40),
  set_name      text not null check (set_name in ('dev', 'heldout')),
  case_type     text not null check (case_type in ('fits', 'wrong_stage', 'investor', 'injection', 'polite_spam', 'other')),
  author        text not null check (char_length(author) <= 80),
  rules         text not null check (char_length(rules) between 1 and 1000),
  ask_text      text not null check (char_length(ask_text) between 1 and 1000),
  expected      text not null check (expected in ('accept', 'decline', 'ask_back')),
  notes         text,
  frozen_at     timestamptz,
  created_at    timestamptz not null default now()
);

create table public.eval_runs (
  id            text primary key check (char_length(id) <= 40),
  label         text not null check (char_length(label) <= 80),
  set_name      text not null check (set_name in ('dev', 'heldout')),
  model         text not null,
  rubric_hash   text not null,
  baseline      boolean not null default false,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  totals        jsonb check (totals is null or jsonb_typeof(totals) = 'object')
);

create table public.eval_results (
  run_id        text not null references public.eval_runs (id) on delete cascade,
  case_id       text not null references public.eval_cases (id) on delete cascade,
  verdict       text check (verdict in ('accept', 'decline', 'ask_back')),
  cited         jsonb not null default '[]'::jsonb,
  decided_by    text check (decided_by in ('gate', 'clause_check')),
  error_kind    text,
  correct       boolean not null,
  latency_ms    integer,
  created_at    timestamptz not null default now(),
  primary key (run_id, case_id)
);

-- ============================================================================================================
-- Helper SQL: the prefilter, the REAL line and the board
-- ============================================================================================================

-- Every member an ask would fan out to, with the reason SQL drops them before any model call:
-- self (the asker), paused, at_cap (this month's usage ≥ cap), repeat_pair (this member was already offered
-- an ask from this asker in the last 90 days). Members without rules or not yet on are not in the network.
create or replace function public.prefilter_members(p_asker uuid, p_at timestamptz default now())
returns table (member_id uuid, rules_text text, rules_version integer, cap smallint, used integer, skip text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    r.text,
    r.version,
    m.cap,
    coalesce(cu.used, 0),
    case
      when m.id = p_asker then 'self'
      when not public.member_is_active(m, p_at) then 'paused'
      when coalesce(cu.used, 0) >= m.cap then 'at_cap'
      when exists (
        select 1 from public.offers o join public.asks a on a.id = o.ask_id
        where o.member_id = m.id and a.asker_id = p_asker and o.offered_at > p_at - interval '90 days'
      ) then 'repeat_pair'
      else null
    end
  from public.members m
  join public.rules r on r.member_id = m.id
  left join public.cap_usage cu on cu.member_id = m.id and cu.month = public.cap_month(p_at)
  where m.status in ('on', 'paused')
  order by m.created_at, m.id
$$;

-- The dated REAL line under the playground lede (counts from audit, so deletions don't rewrite history).
create or replace function public.real_line()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'since', (select min(at) from public.audit where action = 'member_joined'),
    'members', (select count(*) from public.members m where m.status in ('on', 'paused') and exists (select 1 from public.rules r where r.member_id = m.id)),
    'asks', (select count(*) from public.audit where action = 'ask_sent'),
    'intros', (select count(*) from public.audit where action = 'intro_made'),
    'as_of', now()
  )
$$;

-- Every number on /board with its denominator (ux-spec S7). Definitions live here, next to the SQL:
-- interrupted = offers delivered (each used a cap slot, including passes and expiries);
-- useful = intros rated 4–5 at +1 day, or with any +14 day outcome other than nothing_yet;
-- gate checks = gate_checked events (one per member per ask after SQL skips, plus reruns).
create or replace function public.board_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  ev as (select action, ask_id, offer_id, member_id, asker_id, detail, at from public.audit),
  intro_ids as (select distinct ask_id from ev where action = 'intro_made'),
  d1 as (
    select ask_id, detail from ev
    where action = 'checkin_answered' and detail->>'kind' = 'd1'
  ),
  d14 as (
    select ask_id, detail from ev
    where action = 'checkin_answered' and detail->>'kind' = 'd14' and detail->>'role' = 'asker'
  ),
  useful as (
    select distinct ask_id from d1 where (detail->>'rating')::int >= 4
    union
    select distinct ask_id from d14 where detail->>'outcome' is not null and detail->>'outcome' <> 'nothing_yet'
  ),
  answered as (
    select (extract(epoch from (e.at - d.at)) / 3600.0) as hours
    from ev e join ev d on d.offer_id = e.offer_id and d.action = 'offer_delivered'
    where e.action in ('offer_ok', 'offer_answered', 'offer_passed')
  ),
  per_member as (
    select member_id, count(*) as n from ev
    where action = 'offer_delivered' and at >= (select (public.cap_month(now()) at time zone 'America/Los_Angeles'))
    group by member_id
  )
  select jsonb_build_object(
    'as_of', now(),
    'since', (select min(at) from ev where action = 'member_joined'),
    'members_with_rules', (select count(*) from public.members m where exists (select 1 from public.rules r where r.member_id = m.id)),
    'asks_sent', (select count(*) from ev where action = 'ask_sent'),
    'compile_refused', (select count(*) from ev where action = 'compile_refused'),
    'gate_checks', (select count(*) from ev where action = 'gate_checked'),
    'gate_checks_stopped', (select count(*) from ev where action = 'gate_checked' and coalesce(detail->>'verdict', 'failed') <> 'accept'),
    'gate_reruns', (select count(*) from ev where action = 'gate_checked' and (detail->>'attempt')::int = 2),
    'quotes_not_found', (select count(*) from ev where action = 'gate_checked' and detail->>'decided_by' = 'clause_check'),
    'asks_reached_person', (select count(distinct ask_id) from ev where action = 'offer_delivered'),
    'interrupted', (select count(*) from ev where action = 'offer_delivered'),
    'offers_ok', (select count(*) from ev where action = 'offer_ok'),
    'offers_answered', (select count(*) from ev where action = 'offer_answered'),
    'offers_passed', (select count(*) from ev where action = 'offer_passed'),
    'offers_expired', (select count(*) from ev where action = 'offer_expired'),
    'intros', (select count(*) from intro_ids),
    'd1_answered', (select count(distinct ask_id) from d1),
    'calls_happened', (select count(distinct ask_id) from d1 where detail ? 'rating'),
    'useful', (select count(*) from useful),
    'd14_answered', (select count(distinct ask_id) from d14),
    'median_hours_to_answer', (select percentile_cont(0.5) within group (order by hours) from answered),
    'offers_answered_count', (select count(*) from answered),
    'offers_per_member_max', (select coalesce(max(n), 0) from per_member),
    'offers_per_member_median', (
      select coalesce(percentile_cont(0.5) within group (order by coalesce(pm.n, 0)), 0)
      from public.members m left join per_member pm on pm.member_id = m.id
      where exists (select 1 from public.rules r where r.member_id = m.id)
    ),
    'cap_overruns', (
      select count(*) from (
        select o.member_id, o.month, count(*) as n, max(m.cap) as cap
        from public.offers o join public.members m on m.id = o.member_id
        group by o.member_id, o.month
      ) x where x.n > x.cap
    ),
    'members_paused', (select count(*) from public.members where status = 'paused'),
    'members_deleted', (select count(*) from ev where action = 'member_deleted'),
    'playground_runs', (select count(*) from ev where action = 'playground_run'),
    'playground_gate_calls', (select coalesce(sum((detail->>'gates')::int), 0) from ev where action = 'playground_run'),
    'sample_asks_sent', (select count(*) from ev where action = 'sample_ask_sent'),
    'demand', (
      select coalesce(jsonb_agg(jsonb_build_object('topic', topic, 'asks', asks, 'reached', reached, 'askers', askers) order by asks desc), '[]'::jsonb)
      from (
        select a.detail->>'topic' as topic,
               count(*) as asks,
               count(*) filter (where exists (select 1 from ev o where o.action = 'offer_delivered' and o.ask_id = a.ask_id)) as reached,
               count(distinct a.asker_id) as askers
        from ev a
        where a.action = 'ask_sent' and a.detail ? 'topic'
        group by a.detail->>'topic'
        having count(distinct a.asker_id) >= 3
      ) t
    ),
    'demand_other_asks', (
      select coalesce(sum(asks), 0) from (
        select count(*) as asks from ev a where a.action = 'ask_sent'
        group by coalesce(a.detail->>'topic', '')
        having count(distinct a.asker_id) < 3
      ) t
    )
  )
$$;

-- ============================================================================================================
-- Row level security
-- ============================================================================================================

alter table public.members        enable row level security;
alter table public.rule_versions  enable row level security;
alter table public.rules          enable row level security;
alter table public.cap_usage      enable row level security;
alter table public.real_askers    enable row level security;
alter table public.asks           enable row level security;
alter table public.ask_members    enable row level security;
alter table public.questions      enable row level security;
alter table public.gate_decisions enable row level security;
alter table public.offers         enable row level security;
alter table public.intros         enable row level security;
alter table public.checkins       enable row level security;
alter table public.api_tokens     enable row level security;
alter table public.pause_tokens   enable row level security;
alter table public.rate_limits    enable row level security;
alter table public.email_outbox   enable row level security;
alter table public.audit          enable row level security;
alter table public.eval_cases     enable row level security;
alter table public.eval_runs      enable row level security;
alter table public.eval_results   enable row level security;
alter table public.drafts         enable row level security;
alter table public.model_usage    enable row level security;
alter table public.app_state      enable row level security;
alter table public.hook_seen      enable row level security;

-- anon: nothing, anywhere. Supabase grants every new table, sequence and function in public to anon and
-- authenticated by default; take that back here, and stop it for objects later migrations create (0002+ must
-- grant explicitly, next to their RLS policies).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated, public;

-- authenticated: read a few of your own rows; write nothing directly. Every write goes through server code with the
-- service role, which checks the session, audits and cancels scheduled emails where needed. (A direct insert would
-- let someone sign in as A and store B's address as their member email; direct updates would skip the audit.)
-- `asks` is deliberately not readable: an asker's view goes through the serializer (status, close_reason and
-- updated_at would reveal when a member said No). Token hashes are never selectable.
revoke all on all tables in schema public from authenticated;
grant select on public.members, public.rules, public.rule_versions, public.cap_usage, public.intros to authenticated;
grant select (id, ask_id, member_id, position, month, state, offered_at, expires_at, responded_at, answer, no_reason, no_note, created_at)
  on public.offers to authenticated;
grant select (id, intro_id, member_id, role, kind, due_at, sent_at, answer, answered_at, reminder_at, closes_at, created_at)
  on public.checkins to authenticated;
grant select (id, member_id, label, created_at, last_used_at, last_used_from, revoked_at) on public.api_tokens to authenticated;
grant execute on function public.cap_month(timestamptz), public.member_is_active(public.members, timestamptz) to authenticated;

create policy members_select_own on public.members for select to authenticated using (id = (select auth.uid()));
create policy rules_select_own on public.rules for select to authenticated using (member_id = (select auth.uid()));
create policy rule_versions_select_own on public.rule_versions for select to authenticated using (member_id = (select auth.uid()));
create policy cap_usage_select_own on public.cap_usage for select to authenticated using (member_id = (select auth.uid()));
create policy offers_select_own on public.offers for select to authenticated using (member_id = (select auth.uid()));
create policy intros_select_party on public.intros for select to authenticated
  using (member_id = (select auth.uid()) or asker_id = (select auth.uid()));
create policy checkins_select_own on public.checkins for select to authenticated using (member_id = (select auth.uid()));
create policy api_tokens_select_own on public.api_tokens for select to authenticated using (member_id = (select auth.uid()));

-- service_role (server code) has every privilege and bypasses RLS.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
