-- ============================================================================
-- SPHEREx processing jobs and rate limits (PLAN.md item 2: Worker, jobs, cache)
--
-- Netlify Functions NEVER process FITS. They only orchestrate:
--   spherex-job.mjs inserts a job (cache-keyed, rate-limited) and reports
--   status; the Python worker (worker/spherex_worker.py, deployed near IRSA)
--   claims rows through claim_processing_job() and writes products to the
--   'spherex-products' storage bucket.
--
-- Run ONCE in the Supabase SQL editor, like schema.sql.
-- ============================================================================

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,                -- versioned product cache key
  product text not null check (product in ('cutout-render', 'photometry')),
  -- Identity of the data being processed (mirrors the cache key segments).
  collection text not null check (collection ~ '^qr\d+$'),
  obs_id text not null,
  detector text not null check (detector ~ '^D[1-6]$'),
  release text not null,
  ra double precision not null check (ra >= 0 and ra <= 360),
  "dec" double precision not null check ("dec" >= -90 and "dec" <= 90),
  size_deg double precision not null check (size_deg > 0 and size_deg <= 0.5),
  cutout_url text not null check (cutout_url like 'https://irsa.ipac.caltech.edu/%'),
  params jsonb not null default '{}'::jsonb,
  -- Queue state; orchestration maps them to capability records:
  --   queued/running -> 'computing', completed -> 'available', failed -> 'unavailable'
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  error_reason text check (char_length(error_reason) <= 500),
  result_path text check (result_path is null or result_path like 'spherex/%'),
  worker_id text,
  claimed_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index processing_jobs_status_created_idx on public.processing_jobs (status, created_at);
create index processing_jobs_worker_idx on public.processing_jobs (worker_id) where status = 'running';

-- Rate limiting for coordinate queries (per client hash, sliding window in the
-- orchestration function): one row per accepted job request.
create table public.processing_requests (
  id bigint generated always as identity primary key,
  client_key text not null,                      -- salted IP/day hash; no raw IPs
  cache_key text,
  created_at timestamptz not null default now()
);
create index processing_requests_client_idx on public.processing_requests (client_key, created_at desc);

-- Released products live in an object-storage bucket near IRSA.
insert into storage.buckets (id, name, public)
  values ('spherex-products', 'spherex-products', true)
  on conflict (id) do nothing;

-- Players and guests may READ queue state (computing/available/unavailable is
-- shown in browse mode); only the service role (Netlify function, worker)
-- writes. No anon INSERT/UPDATE/DELETE policies exist on purpose.
alter table public.processing_jobs enable row level security;
create policy "processing_jobs readable" on public.processing_jobs
  for select to anon, authenticated using (true);

alter table public.processing_requests enable row level security;
create policy "processing_requests service only" on public.processing_requests
  for select to service_role using (true);

-- ---------------------------------------------------------------------------
-- Atomic claim for the worker: 'for update skip locked' so two workers never
-- grab the same job. Returns the claimed row, or null when the queue is empty.
-- ---------------------------------------------------------------------------
create or replace function public.claim_processing_job(worker_id text)
returns public.processing_jobs
language plpgsql
as $$
declare
  claimed public.processing_jobs;
begin
  update public.processing_jobs
     set status = 'running', worker_id = claim_processing_job.worker_id, claimed_at = now()
   where id = (
     select id from public.processing_jobs
      where status = 'queued'
      order by created_at
      limit 1
      for update skip locked
   )
   returning * into claimed;
  return claimed;
end;
$$;

-- Completed rows stop being interesting; failures are kept longer by design
-- (the reason text feeds capability 'unavailable'). Sweep old rows weekly.
create or replace function public.sweep_processing_jobs()
returns void language sql as $$
  delete from public.processing_jobs
   where status = 'completed' and finished_at < now() - interval '7 days';
  delete from public.processing_jobs
   where status = 'failed' and finished_at < now() - interval '30 days';
  delete from public.processing_requests where created_at < now() - interval '1 day';
$$;
