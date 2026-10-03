-- Nutrition Coach: cloud copy of your records. Run once in Supabase → SQL Editor → New query → Run.
-- Safe to run again. Uses the same project as PPL Coach; separate table.
create table if not exists public.nutrition_records (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id         text not null,
  kind       text not null,
  body       jsonb,
  created_at bigint not null,
  updated_at bigint not null,
  deleted    boolean not null default false,
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists nutrition_records_synced on public.nutrition_records (user_id, synced_at);

-- synced_at is set by the server on every write, so devices can ask "what changed since…".
create or replace function public.nutrition_touch() returns trigger language plpgsql as $$
begin new.synced_at := now(); return new; end $$;
drop trigger if exists nutrition_touch on public.nutrition_records;
create trigger nutrition_touch before insert or update on public.nutrition_records
  for each row execute function public.nutrition_touch();

-- Row-level security: each signed-in user can only see and change their own rows.
alter table public.nutrition_records enable row level security;
drop policy if exists "own rows: select" on public.nutrition_records;
drop policy if exists "own rows: insert" on public.nutrition_records;
drop policy if exists "own rows: update" on public.nutrition_records;
drop policy if exists "own rows: delete" on public.nutrition_records;
create policy "own rows: select" on public.nutrition_records for select to authenticated using (auth.uid() = user_id);
create policy "own rows: insert" on public.nutrition_records for insert to authenticated with check (auth.uid() = user_id);
create policy "own rows: update" on public.nutrition_records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows: delete" on public.nutrition_records for delete to authenticated using (auth.uid() = user_id);
