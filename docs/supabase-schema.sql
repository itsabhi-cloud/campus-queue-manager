-- QueueSense production adapter schema
-- The browser demo currently uses localStorage + BroadcastChannel for zero-setup reliability.
-- Apply this file in Supabase when connecting the UI to hosted persistence/realtime.

create type public.app_role as enum ('student', 'staff', 'admin');
create type public.queue_status as enum ('WAITING', 'CALLED', 'SERVING', 'COMPLETED', 'SKIPPED', 'CANCELLED');
create type public.counter_status as enum ('OPEN', 'PAUSED', 'CLOSED');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  average_service_time_minutes numeric(5,2) not null default 3 check (average_service_time_minutes > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.counters (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete cascade,
  name text not null,
  status public.counter_status not null default 'OPEN',
  assigned_staff_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services(id) on delete restrict,
  counter_id uuid not null references public.counters(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete set null,
  token_number text not null,
  sequence_number integer not null,
  status public.queue_status not null default 'WAITING',
  joined_at timestamptz not null default now(),
  called_at timestamptz,
  serving_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique(counter_id, token_number),
  unique(counter_id, sequence_number)
);

create table public.queue_events (
  id bigint generated always as identity primary key,
  queue_entry_id uuid not null references public.queue_entries(id) on delete cascade,
  event_type text not null check (event_type in ('JOINED', 'CALLED', 'SERVING', 'COMPLETED', 'SKIPPED', 'CANCELLED')),
  actor_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.camera_stations (
  id uuid primary key default gen_random_uuid(),
  counter_id uuid not null references public.counters(id) on delete cascade,
  name text not null,
  roi jsonb not null default '{"x":0.12,"y":0.2,"width":0.76,"height":0.64}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.queue_metrics (
  id bigint generated always as identity primary key,
  camera_station_id uuid not null references public.camera_stations(id) on delete cascade,
  people_count integer not null check (people_count >= 0),
  estimated_wait_minutes numeric(7,2) not null check (estimated_wait_minutes >= 0),
  captured_at timestamptz not null default now()
);

create index queue_entries_active_idx on public.queue_entries(counter_id, status, sequence_number)
  where status in ('WAITING', 'CALLED', 'SERVING');
create index queue_entries_user_active_idx on public.queue_entries(user_id, status);
create index queue_events_entry_time_idx on public.queue_events(queue_entry_id, created_at desc);
create index queue_metrics_station_time_idx on public.queue_metrics(camera_station_id, captured_at desc);

-- Realtime tables: subscribe to queue entries, events, and latest camera metrics.
alter table public.queue_entries replica identity full;
alter table public.queue_events replica identity full;
alter table public.queue_metrics replica identity full;
alter publication supabase_realtime add table public.queue_entries;
alter publication supabase_realtime add table public.queue_events;
alter publication supabase_realtime add table public.queue_metrics;

alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.counters enable row level security;
alter table public.queue_entries enable row level security;
alter table public.queue_events enable row level security;
alter table public.camera_stations enable row level security;
alter table public.queue_metrics enable row level security;

create policy "active services are public" on public.services for select using (is_active = true);
create policy "active counters are public" on public.counters for select using (status <> 'CLOSED');
create policy "students can read active queue entries" on public.queue_entries for select using (status in ('WAITING', 'CALLED', 'SERVING') or user_id = auth.uid());
create policy "students can create their own entries" on public.queue_entries for insert with check (user_id = auth.uid());
create policy "students can cancel their own waiting entry" on public.queue_entries for update using (user_id = auth.uid() and status = 'WAITING') with check (user_id = auth.uid() and status = 'CANCELLED');
create policy "staff can manage assigned counter entries" on public.queue_entries for all using (
  exists (select 1 from public.counters c where c.id = counter_id and c.assigned_staff_id = auth.uid())
);
create policy "staff can write metrics for assigned stations" on public.queue_metrics for insert with check (
  exists (
    select 1 from public.camera_stations cs
    join public.counters c on c.id = cs.counter_id
    where cs.id = camera_station_id and c.assigned_staff_id = auth.uid()
  )
);
create policy "public can read recent metrics" on public.queue_metrics for select using (captured_at > now() - interval '15 minutes');
create policy "admins manage configuration" on public.services for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "admins manage counters" on public.counters for all using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
