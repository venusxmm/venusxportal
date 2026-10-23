alter table public.creators
  add column if not exists internal_photo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creator-photos',
  'creator-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do nothing;

create policy "creator photos staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-photos' and (public.is_executive() or public.has_area('creator_management')));
create policy "creator photos staff insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'creator-photos' and (public.is_executive() or public.has_area('creator_management')));
create policy "creator photos staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'creator-photos' and (public.is_executive() or public.has_area('creator_management')))
  with check (bucket_id = 'creator-photos' and (public.is_executive() or public.has_area('creator_management')));
create policy "creator photos staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'creator-photos' and (public.is_executive() or public.has_area('creator_management')));
