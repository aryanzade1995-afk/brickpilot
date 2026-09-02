-- BrickPilot — saved designs. Run this once in the Supabase SQL editor
-- (Dashboard → SQL → New query → paste → Run).
--
-- A "design" is just a project's brief + pinned direction; the deterministic
-- engine rebuilds the plan, validation and cost from it. Row Level Security
-- scopes every row to its owner — the browser only ever holds the anon key.

create table if not exists public.designs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null default 'Untitled design',
  brief      jsonb not null,
  pinned     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists designs_user_updated_idx
  on public.designs (user_id, updated_at desc);

alter table public.designs enable row level security;

drop policy if exists "designs are private to their owner" on public.designs;
create policy "designs are private to their owner"
  on public.designs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- keep updated_at fresh on every write
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists designs_touch_updated_at on public.designs;
create trigger designs_touch_updated_at
  before update on public.designs
  for each row execute function public.touch_updated_at();
