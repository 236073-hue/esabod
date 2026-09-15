-- ====================================================================
-- ESABOD Schema & Auto-Provisioning
-- Run this in Supabase Dashboard -> SQL Editor
-- ====================================================================

-- 1. Feeder Settings Table
create table if not exists public.feeder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chick_count integer not null default 50 check (chick_count between 1 and 100000),
  feed_level integer not null default 0 check (feed_level between 0 and 100),
  water_level integer not null default 64 check (water_level between 0 and 100),
  temperature numeric(4,1) not null default 27.4,
  feed_weight_g numeric(10,1) not null default 0,
  feed_capacity_g numeric(10,1) not null default 10000 check (feed_capacity_g > 0),
  last_measured_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.feeder_settings add column if not exists feed_weight_g numeric(10,1) not null default 0;
alter table public.feeder_settings add column if not exists feed_capacity_g numeric(10,1) not null default 10000;
alter table public.feeder_settings add column if not exists last_measured_at timestamptz;

-- 2. Feeder Devices Table (ESP32 Scale Credentials)
create table if not exists public.feeder_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_secret text not null unique default gen_random_uuid()::text,
  name text not null default 'Main feed scale',
  created_at timestamptz not null default now()
);

-- 3. Feeder Activity Logs
create table if not exists public.feeder_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  detail text not null,
  kind text not null default 'system' check (kind in ('system', 'feed', 'water', 'temperature')),
  created_at timestamptz not null default now()
);

-- 4. Row Level Security Policies
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

-- 5. RPC: Record reading from ESP32 scale
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
grant execute on function public.record_feeder_reading(uuid, text, numeric) to anon, authenticated;

-- 6. RPC: Auto-provision or retrieve device for the logged-in user
create or replace function public.get_or_create_my_device()
returns table(id uuid, device_secret text, name text)
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  v_dev record;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select d.id, d.device_secret, d.name into v_dev
  from public.feeder_devices d
  where d.user_id = v_user_id
  limit 1;

  if not found then
    insert into public.feeder_devices (user_id, device_secret, name)
    values (v_user_id, gen_random_uuid()::text, 'Main feed scale')
    returning feeder_devices.id, feeder_devices.device_secret, feeder_devices.name into v_dev;
  end if;

  return query select v_dev.id, v_dev.device_secret, v_dev.name;
end;
$$;
revoke all on function public.get_or_create_my_device() from public;
grant execute on function public.get_or_create_my_device() to authenticated;

-- 7. Trigger: Automatically provision workspace AND ESP32 device when any user signs up
create or replace function public.create_feeder_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 1. Create default settings
  insert into public.feeder_settings (user_id) values (new.id) on conflict (user_id) do nothing;

  -- 2. Auto-generate ESP32 scale credentials
  insert into public.feeder_devices (user_id, device_secret, name)
    values (new.id, gen_random_uuid()::text, 'Main feed scale')
    on conflict do nothing;

  -- 3. Activity welcome note
  insert into public.feeder_activity (user_id, title, detail, kind)
    values (new.id, 'Feeder initialized', 'Scale device credentials created', 'system');
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_feeder_workspace on auth.users;
create trigger on_auth_user_created_feeder_workspace after insert on auth.users
  for each row execute procedure public.create_feeder_workspace();

-- 8. Backfill: Provision device for any existing registered users immediately
insert into public.feeder_devices (user_id, device_secret, name)
select u.id, gen_random_uuid()::text, 'Main feed scale'
from auth.users u
where not exists (select 1 from public.feeder_devices d where d.user_id = u.id);

-- 9. Enable Realtime Sync
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feeder_settings') then
    alter publication supabase_realtime add table public.feeder_settings;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feeder_activity') then
    alter publication supabase_realtime add table public.feeder_activity;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feeder_devices') then
    alter publication supabase_realtime add table public.feeder_devices;
  end if;
end;
$$;

-- 10. Automatically output all provisioned devices so you can copy DEVICE_ID & DEVICE_SECRET right away:
select 
  d.id as device_id, 
  d.device_secret, 
  u.email as user_email
from public.feeder_devices d
join auth.users u on u.id = d.user_id;
