-- Run this once in Supabase Dashboard -> SQL Editor.
-- A private workspace is created for every new Supabase Auth user.
create table if not exists public.feeder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chick_count integer not null default 50 check (chick_count between 1 and 100000),
  feed_level integer not null default 78 check (feed_level between 0 and 100),
  water_level integer not null default 64 check (water_level between 0 and 100),
  temperature numeric(4,1) not null default 27.4,
  feed_weight_g numeric(10,1) not null default 0,
  feed_capacity_g numeric(10,1) not null default 10000 check (feed_capacity_g > 0),
  last_measured_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Also applies the new sensor fields when upgrading an existing installation.
alter table public.feeder_settings add column if not exists feed_weight_g numeric(10,1) not null default 0;
alter table public.feeder_settings add column if not exists feed_capacity_g numeric(10,1) not null default 10000;
alter table public.feeder_settings add column if not exists last_measured_at timestamptz;

create table if not exists public.feeder_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_secret text not null unique,
  name text not null default 'ESP32 feed scale',
  created_at timestamptz not null default now()
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
alter table public.feeder_devices enable row level security;
drop policy if exists "Users manage their own feeder settings" on public.feeder_settings;
create policy "Users manage their own feeder settings" on public.feeder_settings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their own feeder activity" on public.feeder_activity;
create policy "Users manage their own feeder activity" on public.feeder_activity for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Users manage their own feeder devices" on public.feeder_devices;
create policy "Users manage their own feeder devices" on public.feeder_devices for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- The ESP32 can only call this function. It cannot read arbitrary user data or
-- use a service-role key; its device secret is verified server-side.
create or replace function public.record_feeder_reading(
  p_device_id uuid,
  p_device_secret text,
  p_weight_grams numeric
) returns public.feeder_settings language plpgsql security definer set search_path = public as $$
declare
  target_user_id uuid;
  target_capacity numeric;
  updated_row public.feeder_settings;
begin
  select user_id into target_user_id from public.feeder_devices
    where id = p_device_id and device_secret = p_device_secret;
  if target_user_id is null then raise exception 'Invalid feeder device credentials'; end if;
  if p_weight_grams < 0 or p_weight_grams > 100000 then raise exception 'Invalid feed weight'; end if;
  select feed_capacity_g into target_capacity from public.feeder_settings where user_id = target_user_id;
  update public.feeder_settings set
    feed_weight_g = round(p_weight_grams, 1),
    feed_level = least(100, round((p_weight_grams / target_capacity) * 100))::integer,
    last_measured_at = now(), updated_at = now()
  where user_id = target_user_id returning * into updated_row;
  return updated_row;
end;
$$;
revoke all on function public.record_feeder_reading(uuid, text, numeric) from public;
grant execute on function public.record_feeder_reading(uuid, text, numeric) to anon;

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
