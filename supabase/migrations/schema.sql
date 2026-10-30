-- ============================================================================
-- COSMIC DETECTIVE · multiplayer backend
-- Paste this whole file into Supabase > SQL Editor > New query > Run. Run it ONCE.
-- ============================================================================

-- ---------------------------------------------------------------- ranks
-- Must match RANKS in src/data/fixtures.ts (tiles needed for each rank).
create or replace function public.rank_of(p_tiles int) returns int
language sql immutable as $$
  select case
    when p_tiles >= 600 then 6
    when p_tiles >= 500 then 5
    when p_tiles >= 420 then 4
    when p_tiles >= 320 then 3
    when p_tiles >= 100 then 2
    else 1 end;
$$;

-- ---------------------------------------------------------------- accounts
-- Supabase already stores passwords safely (hashed) in its own auth.users table.
-- "profiles" is the public side of an account: unique username + public stats.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_.]{3,20}$'),
  tiles integer not null default 0 check (tiles >= 0),
  xp integer not null default 0 check (xp >= 0),
  correct integer not null default 0,
  judged integer not null default 0,
  created_at timestamptz not null default now()
);
-- Two usernames can never differ only by upper/lower case ("Nova" vs "nova").
create unique index profiles_username_key on public.profiles (lower(username));

-- The full game save (private: only its owner can read it).
create table public.saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Runs automatically when someone creates an account.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
  insert into public.saves (user_id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- The sign-up form calls this to say "taken" before creating the account.
create or replace function public.username_available(p_username text) returns boolean
language sql security definer stable set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(p_username));
$$;

-- The game calls this to store progress. Stats can only go UP, never down.
create or replace function public.sync_progress(p_tiles int, p_xp int, p_correct int, p_judged int, p_save jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  update public.profiles
     set tiles   = greatest(tiles,   least(coalesce(p_tiles, 0), 100000)),
         xp      = greatest(xp,      least(coalesce(p_xp, 0), 10000000)),
         correct = greatest(correct, least(coalesce(p_correct, 0), 100000)),
         judged  = greatest(judged,  least(coalesce(p_judged, 0), 100000))
   where id = auth.uid();
  update public.saves set data = coalesce(p_save, '{}'::jsonb), updated_at = now() where user_id = auth.uid();
  select jsonb_build_object('tiles', tiles, 'xp', xp) into v_result from public.profiles where id = auth.uid();
  return v_result;
end $$;

-- ---------------------------------------------------------------- squads
create table public.squads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 30),
  leader_id uuid not null references public.profiles(id) on delete cascade,
  join_code text not null unique,
  created_at timestamptz not null default now()
);
create unique index squads_name_key on public.squads (lower(name));

create table public.squad_members (
  squad_id uuid not null references public.squads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('leader', 'member')),
  joined_at timestamptz not null default now(),
  primary key (user_id)               -- one squad per player
);
create index squad_members_squad_idx on public.squad_members (squad_id);

-- Helpers used by the security rules below (security definer avoids infinite loops).
create or replace function public.is_squad_member(p_squad uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.squad_members where squad_id = p_squad and user_id = auth.uid());
$$;
create or replace function public.is_squad_leader(p_squad uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.squad_members where squad_id = p_squad and user_id = auth.uid() and role = 'leader');
$$;

-- ---------------------------------------------------------------- simulated NASA intake
create sequence public.nasa_report_seq;
create table public.nasa_reports (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads(id) on delete cascade,
  filed_by uuid not null references public.profiles(id) on delete cascade,
  ref text not null,
  summary text not null,
  job_count integer not null,
  filed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- jobs
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads(id) on delete cascade,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id) on delete cascade,
  ra double precision not null,
  dec double precision not null,
  fov double precision not null,
  bands text[] not null default '{}',
  frames jsonb not null default '[]'::jsonb,      -- snapshot of the archive results the leader assigned
  instructions text not null default '',
  status text not null default 'assigned'
    check (status in ('assigned', 'submitted', 'sent_back', 'verified', 'reported')),
  finding text,
  notes text,
  leader_note text,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  verified_at timestamptz,
  reported_at timestamptz,
  report_id uuid references public.nasa_reports(id) on delete set null
);
create index jobs_squad_idx on public.jobs (squad_id);
create index jobs_assignee_idx on public.jobs (assigned_to);

-- ---------------------------------------------------------------- who may READ what
alter table public.profiles       enable row level security;
alter table public.saves          enable row level security;
alter table public.squads         enable row level security;
alter table public.squad_members  enable row level security;
alter table public.jobs           enable row level security;
alter table public.nasa_reports   enable row level security;

create policy "profiles readable by players" on public.profiles for select to authenticated using (true);
create policy "own save"                     on public.saves    for select to authenticated using (user_id = auth.uid());
create policy "my squad"                     on public.squads   for select to authenticated using (public.is_squad_member(id));
create policy "my squad roster"              on public.squad_members for select to authenticated using (public.is_squad_member(squad_id));
create policy "my jobs or squad jobs"        on public.jobs     for select to authenticated
  using (assigned_to = auth.uid() or public.is_squad_leader(squad_id));
create policy "my squad reports"             on public.nasa_reports for select to authenticated using (public.is_squad_member(squad_id));

-- Nobody can write to these tables directly from the browser.
-- Every change goes through the functions below, which check the rules.
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------- squad rules
create or replace function public.create_squad(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_tiles int; v_name text := btrim(coalesce(p_name, '')); v_id uuid; v_code text;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  select tiles into v_tiles from public.profiles where id = v_uid;
  if public.rank_of(coalesce(v_tiles, 0)) < 6 then raise exception 'Only Rank 6 investigators can lead a squad.'; end if;
  if exists (select 1 from public.squad_members where user_id = v_uid) then raise exception 'You are already in a squad.'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 30 then raise exception 'Squad name must be 3 to 30 characters.'; end if;
  if exists (select 1 from public.squads where lower(name) = lower(v_name)) then raise exception 'That squad name is taken.'; end if;
  v_code := upper(substr(md5(random()::text || clock_timestamp()::text || v_uid::text), 1, 6));
  insert into public.squads (name, leader_id, join_code) values (v_name, v_uid, v_code) returning id into v_id;
  insert into public.squad_members (squad_id, user_id, role) values (v_id, v_uid, 'leader');
  return jsonb_build_object('id', v_id, 'join_code', v_code);
end $$;

create or replace function public.join_squad(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_squad uuid; v_leader uuid; v_mine int; v_theirs int;
begin
  if v_uid is null then raise exception 'Not signed in.'; end if;
  select id, leader_id into v_squad, v_leader from public.squads where join_code = upper(btrim(coalesce(p_code, '')));
  if v_squad is null then raise exception 'No squad has that join code.'; end if;
  if exists (select 1 from public.squad_members where user_id = v_uid) then raise exception 'You are already in a squad.'; end if;
  select public.rank_of(tiles) into v_mine   from public.profiles where id = v_uid;
  select public.rank_of(tiles) into v_theirs from public.profiles where id = v_leader;
  if v_mine >= v_theirs then raise exception 'You must hold a lower rank than the squad leader to join.'; end if;
  if (select count(*) from public.squad_members where squad_id = v_squad) >= 8 then raise exception 'That squad is full (8 players).'; end if;
  insert into public.squad_members (squad_id, user_id, role) values (v_squad, v_uid, 'member');
end $$;

create or replace function public.leave_squad() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if exists (select 1 from public.squad_members where user_id = auth.uid() and role = 'leader') then
    raise exception 'Leaders cannot leave. Disband the squad instead.';
  end if;
  delete from public.squad_members where user_id = auth.uid();
end $$;

create or replace function public.disband_squad() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  delete from public.squads where leader_id = auth.uid();   -- members, jobs and reports go with it
end $$;

-- ---------------------------------------------------------------- job rules
-- p_items looks like: [{"user_id": "...", "bands": ["D1","D2"], "frames": [ ... ]}, ...]
create or replace function public.assign_jobs(
  p_squad uuid, p_ra double precision, p_dec double precision, p_fov double precision,
  p_instructions text, p_items jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_item jsonb; v_member uuid; v_bands text[]; v_count int := 0;
begin
  if not public.is_squad_leader(p_squad) then raise exception 'Only the squad leader can assign data.'; end if;
  if p_ra < 0 or p_ra > 360 or p_dec < -90 or p_dec > 90 or p_fov <= 0 or p_fov > 30 then
    raise exception 'Those coordinates are out of range.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 7 then
    raise exception 'Choose between 1 and 7 squad members.';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_member := (v_item ->> 'user_id')::uuid;
    if not exists (select 1 from public.squad_members where squad_id = p_squad and user_id = v_member and role = 'member') then
      raise exception 'Every assignee must be a member of your squad.';
    end if;
    if jsonb_typeof(v_item -> 'frames') <> 'array' or jsonb_array_length(v_item -> 'frames') < 1 or jsonb_array_length(v_item -> 'frames') > 200 then
      raise exception 'Each assignment needs between 1 and 200 archive observations.';
    end if;
    select coalesce(array_agg(distinct b), '{}') into v_bands
      from jsonb_array_elements_text(coalesce(v_item -> 'bands', '[]'::jsonb)) as b;
    insert into public.jobs (squad_id, assigned_to, assigned_by, ra, dec, fov, bands, frames, instructions)
    values (p_squad, v_member, auth.uid(), p_ra, p_dec, p_fov, v_bands, v_item -> 'frames', left(btrim(coalesce(p_instructions, '')), 500));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.submit_job(p_job uuid, p_finding text, p_notes text) returns void
language plpgsql security definer set search_path = public as $$
declare v_notes text := btrim(coalesce(p_notes, ''));
begin
  if auth.uid() is null then raise exception 'Not signed in.'; end if;
  if p_finding not in ('no_anomaly', 'variable_source', 'moving_source', 'data_quality') then raise exception 'Pick a finding.'; end if;
  if char_length(v_notes) < 10 then raise exception 'Add at least a short note (10+ characters) explaining what you saw.'; end if;
  update public.jobs
     set status = 'submitted', finding = p_finding, notes = left(v_notes, 2000), submitted_at = now()
   where id = p_job and assigned_to = auth.uid() and status in ('assigned', 'sent_back');
  if not found then raise exception 'This job cannot be submitted right now.'; end if;
end $$;

create or replace function public.review_job(p_job uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v_squad uuid;
begin
  select squad_id into v_squad from public.jobs where id = p_job;
  if v_squad is null or not public.is_squad_leader(v_squad) then raise exception 'Only the squad leader can review jobs.'; end if;
  update public.jobs
     set status = case when p_approve then 'verified' else 'sent_back' end,
         leader_note = left(btrim(coalesce(p_note, '')), 500),
         verified_at = case when p_approve then now() else null end
   where id = p_job and status = 'submitted';
  if not found then raise exception 'Only submitted jobs can be reviewed.'; end if;
end $$;

-- Files verified jobs in the SIMULATED NASA intake. Nothing leaves this database.
create or replace function public.report_to_nasa(p_squad uuid, p_job_ids uuid[], p_summary text) returns text
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_ref text; v_id uuid; v_summary text := btrim(coalesce(p_summary, ''));
begin
  if not public.is_squad_leader(p_squad) then raise exception 'Only the squad leader can file a report.'; end if;
  v_ids := array(select distinct unnest(p_job_ids));
  if coalesce(cardinality(v_ids), 0) < 1 then raise exception 'Select at least one verified job.'; end if;
  if char_length(v_summary) < 10 then raise exception 'Write a short cover summary (10+ characters).'; end if;
  if (select count(*) from public.jobs where squad_id = p_squad and id = any (v_ids) and status = 'verified') <> cardinality(v_ids) then
    raise exception 'Only verified jobs from your squad can be reported.';
  end if;
  v_ref := 'SIM-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.nasa_report_seq')::text, 5, '0');
  insert into public.nasa_reports (squad_id, filed_by, ref, summary, job_count)
    values (p_squad, auth.uid(), v_ref, left(v_summary, 2000), cardinality(v_ids)) returning id into v_id;
  update public.jobs set status = 'reported', reported_at = now(), report_id = v_id where id = any (v_ids);
  return v_ref;
end $$;

-- ---------------------------------------------------------------- TESTING HELPER (optional)
-- To make an account Rank 6 instantly, run this with the real username:
--   update public.profiles set tiles = 700 where lower(username) = lower('YourUsername');
