-- Proposed migration for docs/requests/s7-site.md (“board counts as of a checkpoint”), kept here so
-- tests/site/board-sql.test.ts can prove it on PGlite before BE2 or the integrator copies it into
-- supabase/migrations/0003_board_as_of.sql.
--
-- Why: /board is public and regenerates every minute. With the counts as they are now, an asker who is the only one
-- with an open ask can watch “people interrupted” move the minute a member passes, which the asker serializer hides
-- until the next 09:00 / 21:00 checkpoint (docs/CONTRACT.md §d.5). Counting every audit fact up to the last
-- checkpoint gives the board the same timing askers get. lib/server/board.ts already calls
-- board_snapshot(p_as_of => last checkpoint) and falls back to the zero-argument function until this ships.
--
-- Same numbers as 0001's board_snapshot(), with every audit fact and every row filtered to `p_as_of`. The old
-- zero-argument function is dropped so a call without arguments isn't ambiguous (it now means “as of now”).

drop function if exists public.board_snapshot();

create or replace function public.board_snapshot(p_as_of timestamptz default now())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with
  ev as (select action, ask_id, offer_id, member_id, asker_id, detail, at from public.audit where at <= p_as_of),
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
    where action = 'offer_delivered' and at >= (select (public.cap_month(p_as_of) at time zone 'America/Mexico_City'))
    group by member_id
  ),
  members_then as (
    select m.id from public.members m
    where m.created_at <= p_as_of and exists (select 1 from public.rules r where r.member_id = m.id)
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'since', (select min(at) from ev where action = 'member_joined'),
    'members_with_rules', (select count(*) from members_then),
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
      from members_then m left join per_member pm on pm.member_id = m.id
    ),
    'cap_overruns', (
      select count(*) from (
        select o.member_id, o.month, count(*) as n, max(m.cap) as cap
        from public.offers o join public.members m on m.id = o.member_id
        where o.offered_at <= p_as_of
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

revoke execute on function public.board_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function public.board_snapshot(timestamptz) to service_role;
