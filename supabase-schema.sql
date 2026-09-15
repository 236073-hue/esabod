-- Run this once in Supabase Dashboard -> SQL Editor.
-- A private workspace is created for every new Supabase Auth user.
create table if not exists public.feeder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chick_count integer not null default 50 check (chick_count between 1 and 100000),
  feed_level integer not null default 78 check (feed_level between 0 and 100),
  water_level integer not null default 64 check (water_level between 0 and 100),
  temperature numeric(4,1) not null default 27.4,
  updated_at timestamptz not null default now()
);

create table if not exists public.feeder_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  detail text not null,
  kind text not null default 'system' check (kind in ('system', 'feed', 'water', 'temperature')),
  created_at timestamptz not null default now()
);

alter table public.feeder_settings enable row level security;
alter table public.feeder_activity enable row level security;
drop policy if exists "Users manage their own feeder settings" on public.feeder_settings;
create policy "Users manage their own feeder settings" on public.feeder_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their own feeder activity" on public.feeder_activity;
create policy "Users manage their own feeder activity" on public.feeder_activity for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function public.create_feeder_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.feeder_settings (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.feeder_activity (user_id, title, detail, kind)
    values (new.id, 'Feeder connected', 'Monitoring is active', 'system');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_feeder_workspace on auth.users;
create trigger on_auth_user_created_feeder_workspace after insert on auth.users
  for each row execute procedure public.create_feeder_workspace();

-- Enables live synchronization between open sessions/devices. Safe to run again.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feeder_settings') then
    alter publication supabase_realtime add table public.feeder_settings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feeder_activity') then
    alter publication supabase_realtime add table public.feeder_activity;
  end if;
end;
$$;
