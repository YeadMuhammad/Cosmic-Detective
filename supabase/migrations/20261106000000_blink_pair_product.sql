-- Permit the worker's registered, matched-image blink product.
alter table public.processing_jobs
  drop constraint if exists processing_jobs_product_check;
alter table public.processing_jobs
  add constraint processing_jobs_product_check
  check (product in ('cutout-render', 'photometry', 'blink-pair'));
