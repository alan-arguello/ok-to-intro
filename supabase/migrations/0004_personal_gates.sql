-- Personal gates: a public link (/g/<slug>) where anyone can send an ask that is checked against one owner's rules
-- and monthly cap. No accounts: the owner holds a private inbox link whose token is stored only as a SHA-256 hash.
-- Server-only access through the service role (RLS on, no policies, anon/authenticated revoked).
create table public.personal_gates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  headline text check (char_length(headline) <= 120),
  rules text not null check (char_length(rules) between 1 and 1000),
  cap smallint not null default 2 check (cap between 1 and 10),
  owner_token_hash text not null,
  created_at timestamptz not null default now()
);
create table public.personal_gate_asks (
  id uuid primary key default gen_random_uuid(),
  gate_id uuid not null references public.personal_gates(id) on delete cascade,
  asker_name text not null check (char_length(asker_name) between 1 and 80),
  asker_email text not null check (char_length(asker_email) between 3 and 200),
  text text not null check (char_length(text) between 1 and 1200),
  verdict text not null check (verdict in ('accept','decline','ask_back','over_cap')),
  cited jsonb not null default '[]'::jsonb,
  reason text, question text,
  created_at timestamptz not null default now()
);
create index personal_gate_asks_gate_created on public.personal_gate_asks (gate_id, created_at desc);
alter table public.personal_gates enable row level security;
alter table public.personal_gate_asks enable row level security;
revoke all on public.personal_gates, public.personal_gate_asks from anon, authenticated;
grant all on public.personal_gates, public.personal_gate_asks to service_role;
