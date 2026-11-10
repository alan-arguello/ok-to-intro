-- OK to Intro · 0002_network.sql · the REAL network pipeline (owner: BE2)
--
-- Every change to an ask, an offer, an intro or a check-in is one of the functions below, called by server code with
-- the service role (supabase-js `rpc`). Each call is one transaction: a state change, its audit row and the step it
-- causes (the next offer in line, the intro and its check-ins, the next queued ask) commit together or not at all.
-- Offers are still made only by public.create_offer (0001), which takes the cap slot under a row lock.
--
-- Nothing here is callable by anon or authenticated. Askers read their asks only through the server's serializer
-- (lib/server/serializer.ts); members act on offers only through server code that checked a link token or a session.
-- Reads return the internal state to the server, never to a browser: the serializer and the view builders decide
-- what each person may see.
--
-- Time: every function takes the instant as a parameter (p_now). The server reads the clock once per request and
-- the tests move it. Pacific time (PT) is the network's zone: cap months (0001), deadlines and the asker's 09:00 / 21:00
-- checkpoints.
--
-- Link tokens: the server derives each offer's and check-in's link token from TOKEN_HMAC_SECRET and the object's id,
-- so an email can be rebuilt byte for byte on a retry or a reminder. Only its HMAC is stored (token_hash, as in 0001).

-- ============================================================================================================
-- Internal helpers (not granted to anyone; called from the functions below)
-- ============================================================================================================

-- One fact for the public board (public.audit). Facts only: never rules, ask text, names or emails.
create or replace function public.net__audit(
  p_action text, p_at timestamptz, p_member uuid, p_asker uuid, p_ask text, p_offer text, p_detail jsonb default '{}'::jsonb,
  p_actor uuid default null
)
returns void
language sql
set search_path = ''
as $$
  insert into public.audit (at, action, actor_id, member_id, asker_id, ask_id, offer_id, detail)
  values (p_at, p_action, p_actor, p_member, p_asker, p_ask, p_offer, coalesce(p_detail, '{}'::jsonb))
$$;

-- The first asker checkpoint (09:00 or 21:00 Pacific time (PT)) at or after p_ts. A change a member caused at p_ts
-- becomes visible to the asker at this instant (docs/CONTRACT.md §d.5; lib/server/checkpoints.ts is the same rule).
create or replace function public.net__ceil_checkpoint(p_ts timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select min(c) from (
    select (((p_ts at time zone 'America/Los_Angeles')::date + g.n) + make_interval(hours => h.hour)) at time zone 'America/Los_Angeles' as c
    from generate_series(-1, 1) as g(n)
    cross join (values (9), (21)) as h(hour)
  ) x
  where c >= p_ts
$$;

-- When one of an asker's open asks closes, their oldest queued ask becomes ready (the server then sends it).
-- “Open” counts every ask still waiting on the network or on its asker: ready, gating, open, answered, and failed
-- (fail closed: saved for a Retry), so retrying a failed ask can never take an asker past 3.
create or replace function public.net__promote_queued(p_asker uuid, p_now timestamptz)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_open integer;
  v_id   text;
begin
  select count(*) into v_open from public.asks
   where asker_id = p_asker and status in ('ready', 'gating', 'open', 'answered', 'failed');
  if v_open >= 3 then
    return null;
  end if;
  select id into v_id from public.asks
   where asker_id = p_asker and status = 'queued'
   order by created_at, id
   limit 1
   for update skip locked;
  if v_id is null then
    return null;
  end if;
  update public.asks set status = 'ready' where id = v_id;
  return v_id;
end
$$;

-- Closes an open ask (all passed, the deadline, no choice after an answer, solved) and promotes a queued one.
create or replace function public.net__close(p_ask text, p_reason text, p_closed_at timestamptz, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_asker uuid;
  v_offers integer;
begin
  update public.asks set status = 'closed', close_reason = p_reason, closed_at = p_closed_at
   where id = p_ask
  returning asker_id into v_asker;
  select count(*) into v_offers from public.offers where ask_id = p_ask;
  perform public.net__audit('ask_closed', p_now, null, v_asker, p_ask, null, jsonb_build_object('reason', p_reason, 'offered', v_offers));
  return jsonb_build_object('outcome', 'closed', 'reason', p_reason, 'promoted', public.net__promote_queued(v_asker, p_now));
end
$$;

-- Offers an open ask that nobody holds to the next person in line, or settles it. The caller holds the ask's lock.
-- Line order: every member whose latest gate decision is an accept, who wasn't offered this ask yet and who can take
-- an offer now (gate on, a free slot this month), by the most unused cap this month, then the earliest answer, then
-- the waffle position. public.create_offer makes the offer and checks both again under its locks: no row means that
-- member just became unable to take it (cap full, paused), so the next one is tried.
-- p_slots: [{offer_id, token_hash}, …] minted by the server, one per attempt; `need_more` when they run out.
-- Outcomes: offered · held (someone has it) · not_open · need_more · waiting (a question waits on the asker) ·
-- closed (deadline, all_passed) · no_match (no accept could ever be offered).
create or replace function public.net__advance(p_ask text, p_now timestamptz, p_slots jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask       public.asks;
  v_cand      record;
  v_slot      jsonb;
  v_i         integer := 0;
  v_offer     public.offers;
  v_pos       smallint;
  v_offers    integer;
  v_last      timestamptz;
  v_deadline  timestamptz;
  v_waiting   integer;
begin
  select * into v_ask from public.asks where id = p_ask for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_ask.status <> 'open' then
    return jsonb_build_object('outcome', 'not_open', 'status', v_ask.status);
  end if;
  if exists (select 1 from public.offers where ask_id = p_ask and state = 'pending') then
    return jsonb_build_object('outcome', 'held');
  end if;
  select count(*), max(responded_at) into v_offers, v_last from public.offers where ask_id = p_ask;

  -- Past the asker's deadline (a Pacific-time date) the ask closes instead of moving on.
  if v_ask.deadline is not null then
    v_deadline := ((v_ask.deadline + 1)::timestamp at time zone 'America/Los_Angeles');
    if p_now >= v_deadline then
      return public.net__close(p_ask, 'deadline', greatest(v_deadline, coalesce(v_last, v_deadline)), p_now);
    end if;
  end if;

  for v_cand in
    with latest as (
      select distinct on (d.member_id) d.member_id, d.verdict, d.created_at
        from public.gate_decisions d
       where d.ask_id = p_ask
       order by d.member_id, d.attempt desc
    )
    select l.member_id, am.position, (m.cap - coalesce(cu.used, 0)) as unused, l.created_at as answered_at
      from latest l
      join public.ask_members am on am.ask_id = p_ask and am.member_id = l.member_id
      join public.members m on m.id = l.member_id
      left join public.cap_usage cu on cu.member_id = l.member_id and cu.month = public.cap_month(p_now)
     where l.verdict = 'accept'
       and not exists (select 1 from public.offers o where o.ask_id = p_ask and o.member_id = l.member_id)
       and public.member_is_active(m, p_now)
       and m.cap > coalesce(cu.used, 0)
     order by unused desc, answered_at asc, am.position asc
  loop
    v_slot := p_slots -> v_i;
    if v_slot is null then
      return jsonb_build_object('outcome', 'need_more');
    end if;
    v_i := v_i + 1;
    select coalesce(max(position), 0) + 1 into v_pos from public.offers where ask_id = p_ask;
    select * into v_offer
      from public.create_offer(v_slot ->> 'offer_id', p_ask, v_cand.member_id, v_slot ->> 'token_hash', v_pos, p_now);
    if found then
      perform public.net__audit('offer_delivered', p_now, v_offer.member_id, v_ask.asker_id, p_ask, v_offer.id,
                                jsonb_build_object('position', v_offer.position));
      return jsonb_build_object(
        'outcome', 'offered', 'offer_id', v_offer.id, 'position', v_offer.position, 'cell', v_cand.position,
        'offered_at', v_offer.offered_at, 'expires_at', v_offer.expires_at
      );
    end if;
  end loop;

  -- Nobody in line can take it. A question that waits on the asker (unanswered, or answered with its reruns
  -- still running) keeps the ask open; otherwise it settles.
  select count(*) into v_waiting from public.questions q
   where q.ask_id = p_ask
     and (q.answer is null or exists (
       select 1 from public.gate_decisions d1
        where d1.ask_id = p_ask and d1.question_id = q.id and d1.attempt = 1
          and not exists (select 1 from public.gate_decisions d2 where d2.ask_id = p_ask and d2.member_id = d1.member_id and d2.attempt = 2)
     ));
  if v_waiting > 0 then
    return jsonb_build_object('outcome', 'waiting');
  end if;
  if v_offers > 0 then
    return public.net__close(p_ask, 'all_passed', coalesce(v_last, p_now), p_now);
  end if;
  update public.asks set status = 'no_match', closed_at = p_now where id = p_ask;
  perform public.net__audit('ask_no_match', p_now, null, v_ask.asker_id, p_ask, null, '{}'::jsonb);
  return jsonb_build_object('outcome', 'no_match', 'promoted', public.net__promote_queued(v_ask.asker_id, p_now));
end
$$;

-- The intro an OK made, and whether its email went out ({} when the offer has no intro). An intro counts as made for
-- the asker, and an OK as done for the member, only once that email is out: until then the OK stands (it can't be
-- taken back), the email is retried, and nobody is told “the intro email went to you both”.
create or replace function public.net__intro_of(p_offer text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('intro_id', i.id, 'intro_sent', i.sent_at is not null) from public.intros i where i.offer_id = p_offer),
    '{}'::jsonb
  )
$$;

-- ============================================================================================================
-- Asking
-- ============================================================================================================

-- What canAskReal needs: whether the person has a members row with a name and company, and whether they are on the
-- REAL allowlist (env emails are seeded into public.real_askers on first use, so Alan sees the list in one place).
create or replace function public.net_asker_access(p_asker uuid, p_email text, p_env_emails jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_member public.members;
begin
  insert into public.real_askers (email, source)
  select lower(e), 'env' from jsonb_array_elements_text(coalesce(p_env_emails, '[]'::jsonb)) as t(e)
   where lower(e) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  on conflict (email) do nothing;
  select * into v_member from public.members where id = p_asker;
  return jsonb_build_object(
    'member', found,
    'name', coalesce(v_member.name, ''),
    'company', coalesce(v_member.company, ''),
    'listed', exists (select 1 from public.real_askers where email = lower(p_email))
  );
end
$$;

-- Creates a REAL ask (never sends it). Idempotent per (asker, idempotency key). `ready`, or `queued` when the asker
-- already has 3 open asks (ready, gating, open, answered, failed); at most 3 more may wait. An edited resend counts
-- against its original: one a week (resend_of always stores the original, so chains count together).
create or replace function public.net_create_ask(
  p_id text, p_asker uuid, p_idempotency_key text, p_raw text, p_compiled jsonb, p_subject text,
  p_deadline date, p_resend_of text, p_now timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_existing public.asks;
  v_root     text;
  v_last     timestamptz;
  v_open     integer;
  v_queued   integer;
  v_status   text;
begin
  -- One asker's creates run one at a time (the open-asks count and the idempotency check stay true).
  perform 1 from public.members where id = p_asker for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_member');
  end if;
  select * into v_existing from public.asks where asker_id = p_asker and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'id', v_existing.id, 'status', v_existing.status, 'repeated', true, 'created_at', v_existing.created_at);
  end if;
  if p_resend_of is not null then
    select coalesce(a.resend_of, a.id) into v_root from public.asks a where a.id = p_resend_of and a.asker_id = p_asker;
    if v_root is null then
      return jsonb_build_object('ok', false, 'reason', 'not_found');
    end if;
    select max(created_at) into v_last from public.asks where asker_id = p_asker and resend_of = v_root;
    if v_last is not null and v_last > p_now - interval '7 days' then
      return jsonb_build_object('ok', false, 'reason', 'too_soon', 'retry_at', v_last + interval '7 days');
    end if;
  end if;
  select count(*) filter (where status in ('ready', 'gating', 'open', 'answered', 'failed')),
         count(*) filter (where status = 'queued')
    into v_open, v_queued
    from public.asks where asker_id = p_asker;
  if v_open >= 3 then
    if v_queued >= 3 then
      return jsonb_build_object('ok', false, 'reason', 'too_many');
    end if;
    v_status := 'queued';
  else
    v_status := 'ready';
  end if;
  insert into public.asks (id, asker_id, network, raw, compiled, subject, status, resend_of, deadline, idempotency_key, created_at)
  values (p_id, p_asker, 'real', p_raw, p_compiled, p_subject, v_status, v_root, p_deadline, p_idempotency_key, p_now);
  return jsonb_build_object('ok', true, 'id', p_id, 'status', v_status, 'repeated', false, 'created_at', p_now);
end
$$;

-- Starts a send: ready (or failed, for a retry) → gating. Snapshots the network into ask_members with fixed shuffled
-- positions and the reason SQL skipped each member (public.prefilter_members), and returns the gates to run with the
-- rules version each one reads. A retry starts over: nothing was offered, so nothing is lost.
create or replace function public.net_begin_send(p_ask text, p_asker uuid, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask  public.asks;
  v_size integer;
begin
  select * into v_ask from public.asks where id = p_ask for update;
  if not found or v_ask.asker_id <> p_asker then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_ask.status = 'queued' then
    return jsonb_build_object('ok', false, 'reason', 'queued');
  end if;
  if v_ask.status not in ('ready', 'failed') then
    return jsonb_build_object('ok', false, 'reason', 'already_sent', 'status', v_ask.status);
  end if;
  delete from public.questions where ask_id = p_ask;
  delete from public.ask_members where ask_id = p_ask; -- cascades to gate_decisions
  insert into public.ask_members (ask_id, member_id, position, skip, created_at)
  select p_ask, f.member_id, (row_number() over (order by md5(p_ask || ':' || f.member_id::text)) - 1)::integer, f.skip, p_now
    from public.prefilter_members(v_ask.asker_id, p_now) f;
  get diagnostics v_size = row_count;
  update public.asks
     set status = 'gating', sent_at = p_now, gated_at = null, network_size = v_size, closed_at = null, close_reason = null
   where id = p_ask;
  if v_ask.sent_at is null then
    perform public.net__audit('ask_sent', p_now, null, v_ask.asker_id, p_ask, null,
      case when nullif(v_ask.compiled ->> 'topic', '') is null then '{}'::jsonb
           else jsonb_build_object('topic', v_ask.compiled ->> 'topic') end);
  end if;
  return jsonb_build_object(
    'ok', true,
    'network_size', v_size,
    'sent_at', p_now,
    'compiled', v_ask.compiled,
    'asker_stage', (select stage from public.members where id = v_ask.asker_id),
    'gates', (
      select coalesce(jsonb_agg(jsonb_build_object('member_id', am.member_id, 'position', am.position, 'rules', r.text, 'rules_version', r.version)
                                order by am.position), '[]'::jsonb)
        from public.ask_members am join public.rules r on r.member_id = am.member_id
       where am.ask_id = p_ask and am.skip is null
    ),
    'skipped', (
      select coalesce(jsonb_agg(am.position order by am.position), '[]'::jsonb)
        from public.ask_members am where am.ask_id = p_ask and am.skip is not null
    )
  );
end
$$;

-- Persists one gate decision before the server streams it. p_result carries the decision after code checks
-- ({verdict, model_verdict, cited, decided_by, reason_code, reason, question, question_id, flags, confidence,
-- error_kind, latency_ms, model, request_id, cost_usd}). An ask_back on the first attempt creates or joins the ask's
-- question of that type (“Your answer goes only to the gates that asked (2)”). Idempotent per (ask, member, attempt).
create or replace function public.net_record_decision(
  p_ask text, p_member uuid, p_attempt integer, p_rules_version integer, p_result jsonb, p_now timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row   public.gate_decisions;
  v_qid   text;
  v_asker uuid;
begin
  select * into v_row from public.gate_decisions where ask_id = p_ask and member_id = p_member and attempt = p_attempt;
  if found then
    return jsonb_build_object('ok', true, 'repeated', true, 'question_id', v_row.question_id);
  end if;
  if p_attempt = 1 and p_result ->> 'verdict' = 'ask_back' and p_result -> 'question' is not null then
    insert into public.questions (id, ask_id, type, text, gates, created_at)
    values (p_result ->> 'question_id', p_ask, p_result -> 'question' ->> 'type', p_result -> 'question' ->> 'text', 1, p_now)
    on conflict (ask_id, type) do update set gates = public.questions.gates + 1
    returning id into v_qid;
  end if;
  insert into public.gate_decisions (
    ask_id, member_id, attempt, rules_version, verdict, model_verdict, cited, decided_by, clause_verified, reason_code,
    reason, question, question_id, flags, confidence, error_kind, latency_ms, model, source, request_id, cost_usd, created_at
  ) values (
    p_ask, p_member, p_attempt, p_rules_version,
    p_result ->> 'verdict',
    p_result ->> 'model_verdict',
    coalesce(p_result -> 'cited', '[]'::jsonb),
    p_result ->> 'decided_by',
    coalesce((p_result ->> 'clause_verified')::boolean, false),
    p_result ->> 'reason_code',
    left(p_result ->> 'reason', 500),
    case when v_qid is null then null else p_result -> 'question' end,
    v_qid,
    coalesce((select array_agg(f) from jsonb_array_elements_text(coalesce(p_result -> 'flags', '[]'::jsonb)) as t(f)), '{}'),
    (p_result ->> 'confidence')::real,
    p_result ->> 'error_kind',
    (p_result ->> 'latency_ms')::integer,
    p_result ->> 'model',
    'live',
    p_result ->> 'request_id',
    (p_result ->> 'cost_usd')::numeric,
    p_now
  )
  on conflict (ask_id, member_id, attempt) do nothing;
  select asker_id into v_asker from public.asks where id = p_ask;
  perform public.net__audit('gate_checked', p_now, p_member, v_asker, p_ask, null, jsonb_build_object(
    'verdict', p_result ->> 'verdict', 'decided_by', p_result ->> 'decided_by', 'attempt', p_attempt));
  return jsonb_build_object('ok', true, 'repeated', false, 'question_id', v_qid);
end
$$;

-- Ends a send. More than 1 in 5 gates not checked (failed, or never recorded) fails closed: nothing is offered and
-- the ask is saved for a retry. Otherwise the ask opens and goes to the best accept (or settles).
create or replace function public.net_finish_send(p_ask text, p_now timestamptz, p_slots jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask    public.asks;
  v_ran    integer;
  v_failed integer;
  v_res    jsonb;
begin
  select * into v_ask from public.asks where id = p_ask for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_ask.status <> 'gating' then
    return jsonb_build_object('outcome', 'not_gating', 'status', v_ask.status);
  end if;
  select count(*) into v_ran from public.ask_members where ask_id = p_ask and skip is null;
  select count(*) into v_failed from public.ask_members am
   where am.ask_id = p_ask and am.skip is null
     and not exists (select 1 from public.gate_decisions d
                      where d.ask_id = p_ask and d.member_id = am.member_id and d.attempt = 1 and d.verdict is not null);
  if v_ran > 0 and v_failed * 5 > v_ran then
    update public.asks set status = 'failed', gated_at = p_now where id = p_ask;
    perform public.net__audit('ask_failed_closed', p_now, null, v_ask.asker_id, p_ask, null,
                              jsonb_build_object('gates', v_ran, 'failed', v_failed));
    return jsonb_build_object('outcome', 'failed', 'gates_ran', v_ran, 'gates_failed', v_failed);
  end if;
  update public.asks set status = 'open' where id = p_ask;
  v_res := public.net__advance(p_ask, p_now, p_slots);
  update public.asks set gated_at = p_now where id = p_ask;
  return v_res || jsonb_build_object(
    'gates_ran', v_ran, 'gates_failed', v_failed,
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'type', q.type, 'text', q.text, 'gates', q.gates)
                                            order by q.created_at, q.id), '[]'::jsonb)
                    from public.questions q where q.ask_id = p_ask and q.answer is null)
  );
end
$$;

-- Who owns an ask and where it stands (the server's background send of a ready ask checks it first).
create or replace function public.net_ask_owner(p_ask text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('asker_id', asker_id, 'status', status) from public.asks where id = p_ask
$$;

-- The advance loop for the server when a first call needed more slots (rare: many accepts at their cap).
create or replace function public.net_advance(p_ask text, p_now timestamptz, p_slots jsonb)
returns jsonb
language sql
set search_path = ''
as $$
  select public.net__advance(p_ask, p_now, p_slots)
$$;

-- Everything time does to one ask, evaluated lazily on read (and by the daily cron): pending offers past 72 hours
-- expire; an answered ask with no choice 72 hours after the asker could see the answer closes; an open ask nobody
-- holds goes to the next person in line, or closes (deadline, everyone passed).
create or replace function public.net_tick_ask(p_ask text, p_now timestamptz, p_slots jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask     public.asks;
  v_expired jsonb;
  v_res     jsonb := '{}'::jsonb;
  v_ans     timestamptz;
  v_timeout timestamptz;
begin
  select * into v_ask from public.asks where id = p_ask for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'expired', '[]'::jsonb);
  end if;
  with ex as (
    update public.offers set state = 'expired', responded_at = expires_at
     where ask_id = p_ask and state = 'pending' and expires_at <= p_now
    returning id, member_id, expires_at
  ), au as (
    insert into public.audit (at, action, member_id, asker_id, ask_id, offer_id, detail)
    select ex.expires_at, 'offer_expired', ex.member_id, v_ask.asker_id, p_ask, ex.id, '{}'::jsonb from ex
    returning 1
  )
  select coalesce(jsonb_agg(ex.id), '[]'::jsonb) into v_expired from ex;
  if v_ask.status = 'answered' then
    select max(responded_at) into v_ans from public.offers where ask_id = p_ask and state = 'answered';
    if v_ans is not null then
      v_timeout := public.net__ceil_checkpoint(v_ans) + interval '72 hours';
      if p_now >= v_timeout then
        v_res := public.net__close(p_ask, 'answer_timeout', v_timeout, p_now);
      end if;
    end if;
  elsif v_ask.status = 'open' then
    v_res := public.net__advance(p_ask, p_now, p_slots);
  end if;
  return v_res || jsonb_build_object('expired', v_expired);
end
$$;

-- Asks that need a tick now, scoped to one member's offers, one asker's asks, or (both null, the cron) all of them:
-- a pending offer past 72 hours, an open ask nobody holds, an answered ask past its choice window.
create or replace function public.net_due_asks(p_now timestamptz, p_member uuid default null, p_asker uuid default null, p_limit integer default 200)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(id), '[]'::jsonb) from (
    select a.id from public.asks a
     where (p_asker is null or a.asker_id = p_asker)
       and (
         exists (select 1 from public.offers o
                  where o.ask_id = a.id and o.state = 'pending' and o.expires_at <= p_now
                    and (p_member is null or o.member_id = p_member))
         or (p_member is null and a.status = 'open'
             and not exists (select 1 from public.offers o where o.ask_id = a.id and o.state = 'pending'))
         or (p_member is null and a.status = 'answered')
       )
     order by a.created_at
     limit p_limit
  ) t
$$;

-- ============================================================================================================
-- The asker's side: one ask's internal state for the serializer, withdraw, resolve, answer a question
-- ============================================================================================================

-- The internal state of one REAL ask for lib/server/serializer.ts. Positions stand in for members: no member id,
-- email or name leaves this function except the name of a member who said OK (the intro). The matched rules travel
-- only for members who turned “Show askers the line that matched” on.
create or replace function public.net__snapshot(p_ask text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'ask', jsonb_build_object(
      'id', a.id, 'subject', a.subject, 'compiled', a.compiled, 'status', a.status, 'close_reason', a.close_reason,
      'deadline', a.deadline, 'network_size', a.network_size, 'created_at', a.created_at, 'sent_at', a.sent_at,
      'gated_at', a.gated_at, 'closed_at', a.closed_at, 'withdrawn_at', a.withdrawn_at, 'resend_of', a.resend_of
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('position', am.position, 'skip', am.skip) order by am.position), '[]'::jsonb)
        from public.ask_members am where am.ask_id = a.id
    ),
    'decisions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', am.position, 'attempt', d.attempt, 'verdict', d.verdict, 'error_kind', d.error_kind,
               'reason_code', d.reason_code, 'question_id', d.question_id, 'created_at', d.created_at)
             order by am.position, d.attempt), '[]'::jsonb)
        from public.gate_decisions d
        join public.ask_members am on am.ask_id = d.ask_id and am.member_id = d.member_id
       where d.ask_id = a.id
    ),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', q.id, 'type', q.type, 'text', q.text, 'gates', q.gates, 'answer', q.answer,
               'answered_at', q.answered_at, 'created_at', q.created_at)
             order by q.created_at, q.id), '[]'::jsonb)
        from public.questions q where q.ask_id = a.id
    ),
    'offers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'position', o.position, 'cell', am.position, 'state', o.state, 'offered_at', o.offered_at,
               'expires_at', o.expires_at, 'responded_at', o.responded_at, 'answer', o.answer,
               'matched', case when m.show_matched then (
                 select jsonb_build_object('rules', rv.text, 'cited', d.cited)
                   from public.gate_decisions d
                   join public.rule_versions rv on rv.member_id = d.member_id and rv.version = d.rules_version
                  where d.ask_id = o.ask_id and d.member_id = o.member_id and d.verdict = 'accept'
                  order by d.attempt desc limit 1
               ) else null end)
             order by o.position), '[]'::jsonb)
        from public.offers o
        join public.ask_members am on am.ask_id = o.ask_id and am.member_id = o.member_id
        join public.members m on m.id = o.member_id
       where o.ask_id = a.id
    ),
    'intro', (
      select jsonb_build_object('member_name', m.name, 'member_line', m.one_line, 'scheduling_url', m.scheduling_url,
                                'sent_at', i.sent_at, 'created_at', i.created_at)
        from public.intros i join public.members m on m.id = i.member_id
       where i.ask_id = a.id
    )
  )
  from public.asks a where a.id = p_ask
$$;

-- One ask's snapshot, only for its asker (null otherwise: someone else's ask reads as not found).
create or replace function public.net_ask_snapshot(p_ask text, p_asker uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.net__snapshot(a.id) from public.asks a where a.id = p_ask and a.asker_id = p_asker and a.network = 'real'
$$;

-- The asker's REAL asks, newest first (S3 “Your asks”, MCP my_asks), as snapshots for the serializer.
create or replace function public.net_ask_snapshots(p_asker uuid, p_limit integer default 50)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.net__snapshot(t.id) order by t.created_at desc, t.id), '[]'::jsonb)
    from (select id, created_at from public.asks where asker_id = p_asker and network = 'real'
           order by created_at desc, id limit p_limit) t
$$;

-- The asker withdraws an ask. The person holding it (if anyone) is told it's no longer needed; nobody else is asked.
-- A slot of the holder's cap stays used (counted at delivery).
create or replace function public.net_withdraw_ask(p_ask text, p_asker uuid, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask  public.asks;
  v_held public.offers;
begin
  select * into v_ask from public.asks where id = p_ask for update;
  if not found or v_ask.asker_id <> p_asker or v_ask.network <> 'real' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_ask.status = 'withdrawn' then
    return jsonb_build_object('ok', true, 'repeated', true, 'withdrawn_at', v_ask.withdrawn_at);
  end if;
  if v_ask.status in ('intro', 'closed', 'no_match') then
    return jsonb_build_object('ok', false, 'reason', 'closed', 'status', v_ask.status);
  end if;
  update public.asks set status = 'withdrawn', withdrawn_at = p_now where id = p_ask;
  update public.offers set state = 'withdrawn', responded_at = p_now
   where ask_id = p_ask and state = 'pending'
  returning * into v_held;
  perform public.net__audit('ask_withdrawn', p_now, null, v_ask.asker_id, p_ask, null, '{}'::jsonb);
  if v_held.id is not null then
    perform public.net__audit('offer_withdrawn', p_now, v_held.member_id, v_ask.asker_id, p_ask, v_held.id, '{}'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true, 'repeated', false, 'withdrawn_at', p_now, 'held_offer_id', v_held.id,
    'promoted', case when v_ask.status in ('ready', 'gating', 'open', 'answered', 'failed') then public.net__promote_queued(v_ask.asker_id, p_now) else null end
  );
end
$$;

-- After a member's 2-line answer: “Did that solve it?” Yes closes the ask; No moves it to the next person in line.
-- Only once the answer is visible to the asker (its checkpoint has passed).
create or replace function public.net_resolve_ask(p_ask text, p_asker uuid, p_solved boolean, p_now timestamptz, p_slots jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask public.asks;
  v_ans timestamptz;
begin
  select * into v_ask from public.asks where id = p_ask for update;
  if not found or v_ask.asker_id <> p_asker or v_ask.network <> 'real' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select max(responded_at) into v_ans from public.offers where ask_id = p_ask and state = 'answered';
  if v_ask.status <> 'answered' then
    if p_solved and v_ask.status = 'closed' and v_ask.close_reason = 'solved' then
      return jsonb_build_object('ok', true, 'repeated', true);
    end if;
    -- “No, keep it open” already moved it on (open again, or settled after the line ran out).
    if not p_solved and v_ans is not null
       and (v_ask.status in ('open', 'intro') or (v_ask.status = 'closed' and v_ask.close_reason in ('all_passed', 'deadline'))) then
      return jsonb_build_object('ok', true, 'repeated', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_answered', 'status', v_ask.status);
  end if;
  if v_ans is null or public.net__ceil_checkpoint(v_ans) > p_now then
    return jsonb_build_object('ok', false, 'reason', 'not_answered', 'status', 'open');
  end if;
  if p_solved then
    return jsonb_build_object('ok', true, 'repeated', false) || public.net__close(p_ask, 'solved', p_now, p_now);
  end if;
  update public.asks set status = 'open' where id = p_ask;
  return jsonb_build_object('ok', true, 'repeated', false, 'advance', public.net__advance(p_ask, p_now, p_slots));
end
$$;

-- The asker answers a gate's question. Saves the answer once (a repeat with the same text is a no-op), puts a price
-- answer on the ask's card, and returns the gates that asked, with the rules each one reads now, for their one rerun.
create or replace function public.net_answer_question(p_ask text, p_asker uuid, p_question text, p_answer text, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask public.asks;
  v_q   public.questions;
begin
  select * into v_ask from public.asks where id = p_ask for update;
  if not found or v_ask.asker_id <> p_asker or v_ask.network <> 'real' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  select * into v_q from public.questions where id = p_question and ask_id = p_ask for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_q.answer is not null then
    if v_q.answer = btrim(p_answer) then
      return jsonb_build_object('ok', true, 'repeated', true, 'question', to_jsonb(v_q), 'gates', '[]'::jsonb);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'already_answered');
  end if;
  if v_ask.status not in ('open', 'answered') then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  update public.questions set answer = btrim(p_answer), answered_at = p_now where id = p_question returning * into v_q;
  if v_q.type = 'price' then
    update public.asks set compiled = jsonb_set(compiled, '{price}', to_jsonb(v_q.answer)) where id = p_ask;
  end if;
  perform public.net__audit('question_answered', p_now, null, v_ask.asker_id, p_ask, null,
                            jsonb_build_object('type', v_q.type, 'gates', v_q.gates));
  return jsonb_build_object(
    'ok', true, 'repeated', false, 'question', to_jsonb(v_q),
    'compiled', (select compiled from public.asks where id = p_ask),
    'asker_stage', (select stage from public.members where id = v_ask.asker_id),
    'gates', (
      select coalesce(jsonb_agg(jsonb_build_object('member_id', d.member_id, 'rules', r.text, 'rules_version', r.version)), '[]'::jsonb)
        from public.gate_decisions d
        join public.rules r on r.member_id = d.member_id
       where d.ask_id = p_ask and d.question_id = p_question and d.attempt = 1
         and not exists (select 1 from public.gate_decisions d2 where d2.ask_id = p_ask and d2.member_id = d.member_id and d2.attempt = 2)
    )
  );
end
$$;

-- The rerun results the asker already triggered (for an idempotent repeat of an answer).
create or replace function public.net_rerun_counts(p_ask text, p_question text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'reran', count(d2.id),
    'accepted', count(d2.id) filter (where d2.verdict = 'accept')
  )
  from public.gate_decisions d1
  left join public.gate_decisions d2 on d2.ask_id = d1.ask_id and d2.member_id = d1.member_id and d2.attempt = 2
  where d1.ask_id = p_ask and d1.question_id = p_question and d1.attempt = 1
$$;

-- ============================================================================================================
-- The member's side: one offer, acting on it, what waits on a member
-- ============================================================================================================

-- One offer with everything its page and its emails need (server only: it includes both people's emails and the
-- member's rules version). Resolved by link token hash, or by offer id for the signed-in member who holds it
-- (p_member null: the server's own lookup by id, e.g. to build the offer email).
create or replace function public.net_offer_view(p_token_hash text, p_offer_id text, p_member uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'offer', jsonb_build_object(
      'id', o.id, 'ask_id', o.ask_id, 'member_id', o.member_id, 'state', o.state, 'position', o.position, 'month', o.month,
      'offered_at', o.offered_at, 'expires_at', o.expires_at, 'responded_at', o.responded_at, 'answer', o.answer,
      'no_reason', o.no_reason, 'no_note', o.no_note
    ),
    'ask', jsonb_build_object('id', a.id, 'subject', a.subject, 'compiled', a.compiled, 'status', a.status, 'withdrawn_at', a.withdrawn_at),
    'asker', jsonb_build_object('id', ak.id, 'name', ak.name, 'company', ak.company, 'stage', ak.stage, 'city', ak.city, 'email', ak.email),
    'member', jsonb_build_object(
      'id', m.id, 'name', m.name, 'email', m.email, 'cap', m.cap, 'status', m.status, 'paused_until', m.paused_until,
      'scheduling_url', m.scheduling_url, 'show_matched', m.show_matched, 'one_line', m.one_line
    ),
    'decision', (
      select jsonb_build_object('rules_version', d.rules_version, 'cited', d.cited, 'rules', rv.text)
        from public.gate_decisions d
        join public.rule_versions rv on rv.member_id = d.member_id and rv.version = d.rules_version
       where d.ask_id = o.ask_id and d.member_id = o.member_id and d.verdict = 'accept'
       order by d.attempt desc limit 1
    ),
    'price_asked', exists (
      select 1 from public.gate_decisions d join public.questions q on q.id = d.question_id
       where d.ask_id = o.ask_id and d.member_id = o.member_id and d.attempt = 1 and q.type = 'price'
    ),
    'nth', (select count(*) from public.offers o2 where o2.member_id = o.member_id and o2.month = o.month
                                                    and (o2.offered_at, o2.id) <= (o.offered_at, o.id)),
    'intro', (select jsonb_build_object('id', i.id, 'sent_at', i.sent_at) from public.intros i where i.offer_id = o.id)
  )
  from public.offers o
  join public.asks a on a.id = o.ask_id
  join public.members ak on ak.id = a.asker_id
  join public.members m on m.id = o.member_id
  where (p_token_hash is not null and o.token_hash = p_token_hash)
     or (p_token_hash is null and o.id = p_offer_id and (p_member is null or o.member_id = p_member))
  limit 1
$$;

-- The member acts on an offer: ok (the intro, both check-ins, the ask is done), answer (2 lines without their name)
-- or no (private; the next person in line gets it). One transition out of pending; repeating the same action is a
-- no-op that reports `repeated`. An offer past its 72 hours expires here first (and the ask moves on).
-- p_checkins (for ok): [{id, token_hash, role, kind, due_at, closes_at}], minted by the server.
create or replace function public.net_respond_offer(
  p_token_hash text, p_offer_id text, p_member uuid, p_action text, p_answer text, p_key text, p_now timestamptz,
  p_intro_id text, p_checkins jsonb, p_slots jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_ask_id text;
  v_ask    public.asks;
  v_offer  public.offers;
  v_c      jsonb;
  v_target text := case p_action when 'ok' then 'ok' when 'answer' then 'answered' when 'no' then 'passed' else null end;
  v_more   jsonb := '{}'::jsonb;
begin
  if v_target is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  select o.ask_id into v_ask_id from public.offers o
   where (p_token_hash is not null and o.token_hash = p_token_hash)
      or (p_token_hash is null and o.id = p_offer_id and o.member_id = p_member);
  if v_ask_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- Lock order everywhere: the ask, then its offers.
  select * into v_ask from public.asks where id = v_ask_id for update;
  select * into v_offer from public.offers o
   where (p_token_hash is not null and o.token_hash = p_token_hash)
      or (p_token_hash is null and o.id = p_offer_id and o.member_id = p_member)
   for update;
  if v_offer.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if v_offer.state = 'pending' and v_offer.expires_at <= p_now then
    update public.offers set state = 'expired', responded_at = expires_at where id = v_offer.id returning * into v_offer;
    perform public.net__audit('offer_expired', v_offer.expires_at, v_offer.member_id, v_ask.asker_id, v_ask.id, v_offer.id, '{}'::jsonb);
    return jsonb_build_object('ok', false, 'reason', 'expired', 'offer_id', v_offer.id, 'ask_id', v_ask.id,
                              'advance', public.net__advance(v_ask.id, p_now, p_slots));
  end if;
  if v_offer.state <> 'pending' then
    -- After an OK, every answer carries the intro and whether its email went out (the server retries it if not).
    if v_offer.state = v_target then
      return jsonb_build_object('ok', true, 'repeated', true, 'offer_id', v_offer.id, 'ask_id', v_ask.id) || public.net__intro_of(v_offer.id);
    end if;
    return jsonb_build_object('ok', false, 'offer_id', v_offer.id, 'ask_id', v_ask.id, 'reason',
      case v_offer.state when 'expired' then 'expired' when 'withdrawn' then 'withdrawn' else 'already_acted' end)
      || public.net__intro_of(v_offer.id);
  end if;
  if p_action = 'answer' and (
       p_answer is null or char_length(btrim(p_answer)) = 0 or char_length(btrim(p_answer)) > 280
       or array_length(string_to_array(btrim(p_answer), E'\n'), 1) > 3) then
    return jsonb_build_object('ok', false, 'reason', 'bad_input', 'offer_id', v_offer.id);
  end if;

  update public.offers
     set state = v_target, responded_at = p_now, idempotency_key = left(p_key, 128),
         answer = case when p_action = 'answer' then btrim(p_answer) else null end
   where id = v_offer.id
  returning * into v_offer;

  if p_action = 'ok' then
    perform public.net__audit('offer_ok', p_now, v_offer.member_id, v_ask.asker_id, v_ask.id, v_offer.id, '{}'::jsonb);
    insert into public.intros (id, ask_id, offer_id, member_id, asker_id, created_at)
    values (p_intro_id, v_ask.id, v_offer.id, v_offer.member_id, v_ask.asker_id, p_now);
    for v_c in select value from jsonb_array_elements(coalesce(p_checkins, '[]'::jsonb)) loop
      insert into public.checkins (id, intro_id, member_id, role, kind, token_hash, due_at, closes_at, created_at)
      values (v_c ->> 'id', p_intro_id,
              case v_c ->> 'role' when 'asker' then v_ask.asker_id else v_offer.member_id end,
              v_c ->> 'role', v_c ->> 'kind', v_c ->> 'token_hash',
              (v_c ->> 'due_at')::timestamptz, (v_c ->> 'closes_at')::timestamptz, p_now);
    end loop;
    update public.asks set status = 'intro' where id = v_ask.id;
    perform public.net__audit('intro_made', p_now, v_offer.member_id, v_ask.asker_id, v_ask.id, v_offer.id, '{}'::jsonb);
    v_more := jsonb_build_object('intro_id', p_intro_id, 'intro_sent', false, 'promoted', public.net__promote_queued(v_ask.asker_id, p_now));
  elsif p_action = 'answer' then
    update public.asks set status = 'answered' where id = v_ask.id and status = 'open';
    perform public.net__audit('offer_answered', p_now, v_offer.member_id, v_ask.asker_id, v_ask.id, v_offer.id, '{}'::jsonb);
  else
    perform public.net__audit('offer_passed', p_now, v_offer.member_id, v_ask.asker_id, v_ask.id, v_offer.id, '{}'::jsonb);
    v_more := jsonb_build_object('advance', public.net__advance(v_ask.id, p_now, p_slots));
  end if;
  return jsonb_build_object('ok', true, 'repeated', false, 'offer_id', v_offer.id, 'ask_id', v_ask.id) || v_more;
end
$$;

-- The optional “Why?” after a No (only the member and Alan see it).
create or replace function public.net_set_no_reason(p_token_hash text, p_offer_id text, p_member uuid, p_reason text, p_note text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id text;
begin
  update public.offers o set no_reason = p_reason, no_note = nullif(btrim(coalesce(p_note, '')), '')
   where o.state = 'passed'
     and ((p_token_hash is not null and o.token_hash = p_token_hash)
       or (p_token_hash is null and o.id = p_offer_id and o.member_id = p_member))
  returning o.id into v_id;
  return jsonb_build_object('ok', v_id is not null);
end
$$;

-- Everything waiting on a member: offers they hold, questions on their own asks, check-ins due, and their cap.
create or replace function public.net_pending_for_member(p_member uuid, p_now timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'member', (select jsonb_build_object('cap', m.cap, 'status', m.status) from public.members m where m.id = p_member),
    'used', coalesce((select used from public.cap_usage where member_id = p_member and month = public.cap_month(p_now)), 0),
    'month', public.cap_month(p_now),
    'offers', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'offer_id', o.id, 'expires_at', o.expires_at, 'subject', a.subject, 'compiled', a.compiled,
               'asker', jsonb_build_object('name', ak.name, 'company', ak.company, 'stage', ak.stage, 'city', ak.city),
               'decision', (
                 select jsonb_build_object('cited', d.cited, 'rules', rv.text)
                   from public.gate_decisions d
                   join public.rule_versions rv on rv.member_id = d.member_id and rv.version = d.rules_version
                  where d.ask_id = o.ask_id and d.member_id = o.member_id and d.verdict = 'accept'
                  order by d.attempt desc limit 1),
               'price_asked', exists (
                 select 1 from public.gate_decisions d join public.questions q on q.id = d.question_id
                  where d.ask_id = o.ask_id and d.member_id = o.member_id and d.attempt = 1 and q.type = 'price'))
             order by o.expires_at), '[]'::jsonb)
        from public.offers o
        join public.asks a on a.id = o.ask_id
        join public.members ak on ak.id = a.asker_id
       where o.member_id = p_member and o.state = 'pending' and o.expires_at > p_now
    ),
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'ask_id', a.id, 'ask_subject', a.subject, 'question_id', q.id, 'type', q.type, 'text', q.text, 'gates', q.gates)
             order by q.created_at), '[]'::jsonb)
        from public.questions q join public.asks a on a.id = q.ask_id
       where a.asker_id = p_member and a.status in ('open', 'answered') and q.answer is null
    ),
    'checkins', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'checkin_id', c.id, 'kind', c.kind, 'due_at', c.due_at,
               'other_name', (select o.name from public.members o
                               where o.id = case c.role when 'asker' then i.member_id else i.asker_id end))
             order by c.due_at), '[]'::jsonb)
        from public.checkins c join public.intros i on i.id = c.intro_id
       where c.member_id = p_member and c.answer is null and c.due_at <= p_now and c.closes_at > p_now
         and i.sent_at is not null
    )
  )
$$;

-- ============================================================================================================
-- Intros and check-ins
-- ============================================================================================================

-- One intro with what its email needs (server only).
create or replace function public.net_intro_view(p_intro text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'intro', jsonb_build_object('id', i.id, 'ask_id', i.ask_id, 'offer_id', i.offer_id, 'created_at', i.created_at, 'sent_at', i.sent_at),
    'ask', jsonb_build_object('id', a.id, 'subject', a.subject, 'compiled', a.compiled),
    'asker', jsonb_build_object('id', ak.id, 'name', ak.name, 'company', ak.company, 'stage', ak.stage, 'city', ak.city, 'email', ak.email),
    'member', jsonb_build_object('id', m.id, 'name', m.name, 'email', m.email, 'one_line', m.one_line,
                                 'scheduling_url', m.scheduling_url, 'show_matched', m.show_matched),
    'decision', (
      select jsonb_build_object('cited', d.cited, 'rules', rv.text)
        from public.gate_decisions d
        join public.rule_versions rv on rv.member_id = d.member_id and rv.version = d.rules_version
       where d.ask_id = i.ask_id and d.member_id = i.member_id and d.verdict = 'accept'
       order by d.attempt desc limit 1
    ),
    'checkins', (
      select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'role', c.role, 'kind', c.kind, 'due_at', c.due_at) order by c.due_at, c.role), '[]'::jsonb)
        from public.checkins c where c.intro_id = i.id
    )
  )
  from public.intros i
  join public.asks a on a.id = i.ask_id
  join public.members ak on ak.id = i.asker_id
  join public.members m on m.id = i.member_id
  where i.id = p_intro
$$;

-- One check-in with what its page and its email need (server only). By link token hash, or by id for its recipient
-- (p_member null: the server's own lookup by id, e.g. to build the check-in email).
create or replace function public.net_checkin_view(p_token_hash text, p_checkin_id text, p_member uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'checkin', jsonb_build_object(
      'id', c.id, 'intro_id', c.intro_id, 'member_id', c.member_id, 'role', c.role, 'kind', c.kind, 'due_at', c.due_at,
      'sent_at', c.sent_at, 'answer', c.answer, 'answered_at', c.answered_at, 'reminder_at', c.reminder_at, 'closes_at', c.closes_at
    ),
    'intro', jsonb_build_object('id', i.id, 'ask_id', i.ask_id, 'created_at', i.created_at),
    'ask', jsonb_build_object('id', a.id, 'subject', a.subject),
    'to', jsonb_build_object('id', me.id, 'name', me.name, 'email', me.email),
    'other', jsonb_build_object('id', ot.id, 'name', ot.name)
  )
  from public.checkins c
  join public.intros i on i.id = c.intro_id
  join public.asks a on a.id = i.ask_id
  join public.members me on me.id = c.member_id
  join public.members ot on ot.id = case c.role when 'asker' then i.member_id else i.asker_id end
  where (p_token_hash is not null and c.token_hash = p_token_hash)
     or (p_token_hash is null and c.id = p_checkin_id and (p_member is null or c.member_id = p_member))
  limit 1
$$;

-- Saves (or changes) a check-in answer until its window closes. “We haven't talked yet” schedules one reminder
-- (p_reminder_at), only the first time. Every change is one audit fact the board counts (latest per check-in).
create or replace function public.net_save_checkin(
  p_token_hash text, p_checkin_id text, p_member uuid, p_answer jsonb, p_now timestamptz, p_reminder_at timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_c     public.checkins;
  v_intro public.intros;
  v_first boolean;
begin
  select * into v_c from public.checkins c
   where (p_token_hash is not null and c.token_hash = p_token_hash)
      or (p_token_hash is null and c.id = p_checkin_id and c.member_id = p_member)
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if p_now >= v_c.closes_at then
    return jsonb_build_object('ok', false, 'reason', 'closed', 'checkin_id', v_c.id);
  end if;
  if p_answer ->> 'kind' is distinct from v_c.kind then
    return jsonb_build_object('ok', false, 'reason', 'bad_input', 'checkin_id', v_c.id);
  end if;
  if v_c.answer is not null and v_c.answer = p_answer then
    return jsonb_build_object('ok', true, 'repeated', true, 'checkin_id', v_c.id);
  end if;
  v_first := v_c.answer is null;
  update public.checkins
     set answer = p_answer, answered_at = p_now,
         reminder_at = case when (p_answer ->> 'not_yet')::boolean is true and v_c.reminder_at is null then p_reminder_at else v_c.reminder_at end
   where id = v_c.id
  returning * into v_c;
  select * into v_intro from public.intros where id = v_c.intro_id;
  perform public.net__audit('checkin_answered', p_now, v_c.member_id, v_intro.asker_id, v_intro.ask_id, v_intro.offer_id,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', v_c.kind, 'role', v_c.role, 'checkin_id', v_c.id, 'first', v_first,
      'rating', (p_answer ->> 'rating')::integer,
      'outcome', p_answer ->> 'outcome',
      'not_yet', (p_answer ->> 'not_yet')::boolean,
      'wont_happen', (p_answer ->> 'wont_happen')::boolean
    )));
  return jsonb_build_object('ok', true, 'repeated', false, 'checkin_id', v_c.id, 'first', v_first,
                            'reminder_at', v_c.reminder_at, 'intro_id', v_c.intro_id);
end
$$;

-- ============================================================================================================
-- Email outbox (keys: offer:<id>, intro:<id>, checkin1:<id>, checkin14:<id>, withdrawn:<id>, outcome:<id>)
-- ============================================================================================================

-- Claims an email key before sending. Returns the row; a key already sent, scheduled or cancelled is not sent again.
create or replace function public.net_outbox_claim(p_key text, p_kind text, p_member uuid, p_send_at timestamptz, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.email_outbox;
begin
  insert into public.email_outbox (key, kind, member_id, status, send_at, created_at, updated_at)
  values (p_key, p_kind, p_member, 'queued', coalesce(p_send_at, p_now), p_now, p_now)
  on conflict (key) do nothing;
  select * into v_row from public.email_outbox where key = p_key for update;
  return to_jsonb(v_row);
end
$$;

-- Records what happened to a send. A check-in or intro email also stamps its row (sent_at, the Resend id).
create or replace function public.net_outbox_result(
  p_key text, p_status text, p_resend_id text, p_error text, p_now timestamptz, p_intro text default null, p_checkin text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.email_outbox
     set status = p_status,
         resend_id = coalesce(p_resend_id, resend_id),
         attempts = attempts + case when p_status in ('sent', 'scheduled', 'failed') then 1 else 0 end,
         last_error = left(p_error, 300)
   where key = p_key;
  if p_status in ('sent', 'scheduled') and p_intro is not null then
    update public.intros set sent_at = coalesce(sent_at, p_now) where id = p_intro;
  end if;
  if p_status in ('sent', 'scheduled') and p_checkin is not null then
    update public.checkins
       set sent_at = coalesce(sent_at, case when p_status = 'scheduled' then due_at else p_now end),
           email_id = coalesce(p_resend_id, email_id)
     where id = p_checkin;
  end if;
end
$$;

-- Cancels a member's unsent email (check-ins only, or everything) and returns the Resend ids still scheduled.
create or replace function public.net_outbox_cancel(p_member uuid, p_scope text, p_key text default null)
returns jsonb
language sql
set search_path = ''
as $$
  with c as (
    update public.email_outbox
       set status = 'cancelled'
     where status in ('queued', 'scheduled', 'failed')
       and (
         (p_key is not null and key = p_key)
         or (p_key is null and member_id = p_member and (p_scope = 'all' or kind = 'checkin'))
       )
    returning key, resend_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'resend_id', resend_id)), '[]'::jsonb) from c
$$;

-- Emails the daily cron retries: queued or failed, due, fewer than 5 attempts.
create or replace function public.net_outbox_due(p_now timestamptz, p_limit integer default 50)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'kind', kind, 'attempts', attempts) order by send_at), '[]'::jsonb)
    from (select key, kind, attempts, send_at from public.email_outbox
           where status in ('queued', 'failed') and send_at <= p_now and attempts < 5
           order by send_at limit p_limit) t
$$;

-- ============================================================================================================
-- Daily cron backstops
-- ============================================================================================================

-- Sends to finish: asks stuck in gating (the function that ran them died) and ready asks nobody sent (a promoted
-- queued ask, or a tab closed between create and send).
create or replace function public.net_unsent_asks(p_now timestamptz, p_limit integer default 20)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'gating', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'asker_id', asker_id)), '[]'::jsonb) from (
       select id, asker_id from public.asks where status = 'gating' and sent_at < p_now - interval '10 minutes'
        order by sent_at limit p_limit) t),
    'ready', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'asker_id', asker_id)), '[]'::jsonb) from (
       select id, asker_id from public.asks where status = 'ready' and network = 'real' and updated_at < p_now - interval '10 minutes'
        order by created_at limit p_limit) t),
    'reruns', (select coalesce(jsonb_agg(jsonb_build_object('ask_id', ask_id, 'question_id', id)), '[]'::jsonb) from (
       select q.ask_id, q.id from public.questions q
        where q.answered_at < p_now - interval '10 minutes'
          and exists (select 1 from public.gate_decisions d1
                       where d1.question_id = q.id and d1.attempt = 1
                         and not exists (select 1 from public.gate_decisions d2
                                          where d2.ask_id = d1.ask_id and d2.member_id = d1.member_id and d2.attempt = 2))
        limit p_limit) t),
    -- Intros whose email hasn't gone out yet (a failed send, or one the function never got to), up to 5 tries.
    'intros', (select coalesce(jsonb_agg(id), '[]'::jsonb) from (
       select i.id from public.intros i
        where i.sent_at is null and i.created_at < p_now - interval '10 minutes'
          and not exists (select 1 from public.email_outbox e
                           where e.key = 'intro:' || i.id and (e.status in ('sent', 'scheduled', 'cancelled') or e.attempts >= 5))
        order by i.created_at limit p_limit) t)
  )
$$;

-- The gates of a stuck send that never recorded a decision (the cron runs them, then finishes the send).
create or replace function public.net_resume_gates(p_ask text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'compiled', (select compiled from public.asks where id = p_ask),
    'asker_stage', (select m.stage from public.asks a join public.members m on m.id = a.asker_id where a.id = p_ask),
    'gates', coalesce(jsonb_agg(jsonb_build_object('member_id', am.member_id, 'position', am.position, 'rules', r.text, 'rules_version', r.version)
                                order by am.position), '[]'::jsonb)
  )
  from public.ask_members am
  join public.rules r on r.member_id = am.member_id
  where am.ask_id = p_ask and am.skip is null
    and not exists (select 1 from public.gate_decisions d where d.ask_id = p_ask and d.member_id = am.member_id and d.attempt = 1)
$$;

-- Reruns that never recorded after an asker's answer (the function that ran them died): each counts as not checked,
-- never an accept, so the ask can move on.
create or replace function public.net_fail_missing_reruns(p_ask text, p_question text, p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_n     integer;
  v_asker uuid;
begin
  select asker_id into v_asker from public.asks where id = p_ask;
  with ins as (
    insert into public.gate_decisions (ask_id, member_id, attempt, rules_version, verdict, error_kind, source, created_at)
    select d1.ask_id, d1.member_id, 2, d1.rules_version, null, 'unavailable', 'live', p_now
      from public.gate_decisions d1
     where d1.ask_id = p_ask and d1.question_id = p_question and d1.attempt = 1
       and not exists (select 1 from public.gate_decisions d2 where d2.ask_id = d1.ask_id and d2.member_id = d1.member_id and d2.attempt = 2)
    on conflict (ask_id, member_id, attempt) do nothing
    returning member_id
  ), au as (
    insert into public.audit (at, action, member_id, asker_id, ask_id, detail)
    select p_now, 'gate_checked', ins.member_id, v_asker, p_ask, jsonb_build_object('verdict', null, 'decided_by', null, 'attempt', 2) from ins
    returning 1
  )
  select count(*) into v_n from ins;
  return jsonb_build_object('settled', v_n);
end
$$;

-- Check-in emails the scheduler never took (no outbox row sent or scheduled for them) and reminders that are due.
-- Only for intros whose email went out: nobody is asked “did you talk?” about an intro they never got.
create or replace function public.net_checkins_due(p_now timestamptz, p_limit integer default 50)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'due', (select coalesce(jsonb_agg(c.id), '[]'::jsonb) from (
       select c.id from public.checkins c
        join public.intros i on i.id = c.intro_id and i.sent_at is not null
        where c.answer is null and c.sent_at is null and c.due_at <= p_now and c.closes_at > p_now
          and not exists (select 1 from public.email_outbox e
                           where e.key = (case c.kind when 'd1' then 'checkin1:' else 'checkin14:' end) || c.id
                             and e.status in ('sent', 'scheduled', 'cancelled'))
        order by c.due_at limit p_limit) c),
    'reminders', (select coalesce(jsonb_agg(c.id), '[]'::jsonb) from (
       select c.id from public.checkins c
        where c.reminder_at is not null and c.reminder_at <= p_now and c.closes_at > p_now
          and (c.answer ->> 'not_yet')::boolean is true
          and not exists (select 1 from public.email_outbox e
                           where e.key = 'checkin1:' || c.id || ':reminder' and e.status in ('sent', 'scheduled', 'cancelled'))
        order by c.reminder_at limit p_limit) c)
  )
$$;

-- Housekeeping: MCP drafts past their 24 hours, rate-limit windows older than a day.
create or replace function public.net_cleanup(p_now timestamptz)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_drafts integer;
  v_limits integer;
begin
  delete from public.drafts where expires_at < p_now;
  get diagnostics v_drafts = row_count;
  delete from public.rate_limits where window_start < p_now - interval '1 day';
  get diagnostics v_limits = row_count;
  return jsonb_build_object('drafts', v_drafts, 'rate_limits', v_limits);
end
$$;

-- ============================================================================================================
-- Privileges: server code only (service_role). 0001 revoked the defaults; grant explicitly, revoke from the rest.
-- ============================================================================================================

revoke execute on function
  public.net__audit(text, timestamptz, uuid, uuid, text, text, jsonb, uuid),
  public.net__ceil_checkpoint(timestamptz),
  public.net__intro_of(text),
  public.net__promote_queued(uuid, timestamptz),
  public.net__close(text, text, timestamptz, timestamptz),
  public.net__advance(text, timestamptz, jsonb),
  public.net__snapshot(text),
  public.net_asker_access(uuid, text, jsonb),
  public.net_create_ask(text, uuid, text, text, jsonb, text, date, text, timestamptz),
  public.net_begin_send(text, uuid, timestamptz),
  public.net_record_decision(text, uuid, integer, integer, jsonb, timestamptz),
  public.net_finish_send(text, timestamptz, jsonb),
  public.net_ask_owner(text),
  public.net_advance(text, timestamptz, jsonb),
  public.net_tick_ask(text, timestamptz, jsonb),
  public.net_due_asks(timestamptz, uuid, uuid, integer),
  public.net_ask_snapshot(text, uuid),
  public.net_ask_snapshots(uuid, integer),
  public.net_withdraw_ask(text, uuid, timestamptz),
  public.net_resolve_ask(text, uuid, boolean, timestamptz, jsonb),
  public.net_answer_question(text, uuid, text, text, timestamptz),
  public.net_rerun_counts(text, text),
  public.net_offer_view(text, text, uuid),
  public.net_respond_offer(text, text, uuid, text, text, text, timestamptz, text, jsonb, jsonb),
  public.net_set_no_reason(text, text, uuid, text, text),
  public.net_pending_for_member(uuid, timestamptz),
  public.net_intro_view(text),
  public.net_checkin_view(text, text, uuid),
  public.net_save_checkin(text, text, uuid, jsonb, timestamptz, timestamptz),
  public.net_outbox_claim(text, text, uuid, timestamptz, timestamptz),
  public.net_outbox_result(text, text, text, text, timestamptz, text, text),
  public.net_outbox_cancel(uuid, text, text),
  public.net_outbox_due(timestamptz, integer),
  public.net_unsent_asks(timestamptz, integer),
  public.net_resume_gates(text),
  public.net_fail_missing_reruns(text, text, timestamptz),
  public.net_checkins_due(timestamptz, integer),
  public.net_cleanup(timestamptz)
from public, anon, authenticated;

grant execute on function
  public.net_asker_access(uuid, text, jsonb),
  public.net_create_ask(text, uuid, text, text, jsonb, text, date, text, timestamptz),
  public.net_begin_send(text, uuid, timestamptz),
  public.net_record_decision(text, uuid, integer, integer, jsonb, timestamptz),
  public.net_finish_send(text, timestamptz, jsonb),
  public.net_ask_owner(text),
  public.net_advance(text, timestamptz, jsonb),
  public.net_tick_ask(text, timestamptz, jsonb),
  public.net_due_asks(timestamptz, uuid, uuid, integer),
  public.net_ask_snapshot(text, uuid),
  public.net_ask_snapshots(uuid, integer),
  public.net_withdraw_ask(text, uuid, timestamptz),
  public.net_resolve_ask(text, uuid, boolean, timestamptz, jsonb),
  public.net_answer_question(text, uuid, text, text, timestamptz),
  public.net_rerun_counts(text, text),
  public.net_offer_view(text, text, uuid),
  public.net_respond_offer(text, text, uuid, text, text, text, timestamptz, text, jsonb, jsonb),
  public.net_set_no_reason(text, text, uuid, text, text),
  public.net_pending_for_member(uuid, timestamptz),
  public.net_intro_view(text),
  public.net_checkin_view(text, text, uuid),
  public.net_save_checkin(text, text, uuid, jsonb, timestamptz, timestamptz),
  public.net_outbox_claim(text, text, uuid, timestamptz, timestamptz),
  public.net_outbox_result(text, text, text, text, timestamptz, text, text),
  public.net_outbox_cancel(uuid, text, text),
  public.net_outbox_due(timestamptz, integer),
  public.net_unsent_asks(timestamptz, integer),
  public.net_resume_gates(text),
  public.net_fail_missing_reruns(text, text, timestamptz),
  public.net_checkins_due(timestamptz, integer),
  public.net_cleanup(timestamptz)
to service_role;

-- The internal helpers run inside the granted functions (as their caller, service_role).
grant execute on function
  public.net__audit(text, timestamptz, uuid, uuid, text, text, jsonb, uuid),
  public.net__ceil_checkpoint(timestamptz),
  public.net__intro_of(text),
  public.net__promote_queued(uuid, timestamptz),
  public.net__close(text, text, timestamptz, timestamptz),
  public.net__advance(text, timestamptz, jsonb),
  public.net__snapshot(text)
to service_role;

-- Reads the snapshot and the line order rely on.
create index if not exists gate_decisions_question on public.gate_decisions (question_id) where question_id is not null;
create index if not exists questions_ask on public.questions (ask_id);
create index if not exists checkins_reminder on public.checkins (reminder_at) where reminder_at is not null;
create index if not exists asks_status_updated on public.asks (status, updated_at) where status in ('ready', 'gating', 'open', 'answered');
