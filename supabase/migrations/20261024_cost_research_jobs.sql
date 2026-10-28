-- Migration: Cost research jobs and evidence cache with RLS
-- Run this in Supabase SQL editor or via Supabase CLI migrations.

create table if not exists public.cost_research_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('queued', 'researching', 'completed', 'partial', 'failed', 'cancelled', 'failed: interrupted')),
  location jsonb not null,
  scope text not null default 'combined',
  source_fingerprint text not null,
  progress jsonb not null default '{"step":"Queued","completed":0,"total":10,"message":"Job queued"}'::jsonb,
  proposals jsonb not null default '[]'::jsonb,
  unresolved_targets jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_research_jobs_user_idx on public.cost_research_jobs (user_id, updated_at desc);
create index if not exists cost_research_jobs_status_idx on public.cost_research_jobs (status);

alter table public.cost_research_jobs enable row level security;

drop policy if exists "users can view their own cost research jobs" on public.cost_research_jobs;
create policy "users can view their own cost research jobs"
  on public.cost_research_jobs for select
  using (auth.uid() = user_id);

drop policy if exists "users can insert their own cost research jobs" on public.cost_research_jobs;
create policy "users can insert their own cost research jobs"
  on public.cost_research_jobs for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own cost research jobs" on public.cost_research_jobs;
create policy "users can update their own cost research jobs"
  on public.cost_research_jobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Public evidence cache (supplier quotes) with bounded retention
create table if not exists public.cost_evidence_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  query_term text not null,
  rate_id text not null,
  city text not null,
  evidence jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists cost_evidence_cache_lookup_idx on public.cost_evidence_cache (rate_id, city, expires_at);
