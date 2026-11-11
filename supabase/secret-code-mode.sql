-- TUNG TUNG+ no-login mode.
-- Run this once in Supabase Dashboard > SQL Editor.
-- The Secret Code is checked by the website only; it is not secure server-side authentication.

alter table public.episodes alter column created_by drop not null;

drop policy if exists "signed in can read episodes" on public.episodes;
drop policy if exists "admins insert episodes" on public.episodes;
drop policy if exists "admins update episodes" on public.episodes;
drop policy if exists "admins delete episodes" on public.episodes;
drop policy if exists "public can read episodes" on public.episodes;
drop policy if exists "public can publish episodes" on public.episodes;
drop policy if exists "public can delete episodes" on public.episodes;

create policy "public can read episodes" on public.episodes
for select to anon using (true);
create policy "public can publish episodes" on public.episodes
for insert to anon with check (true);
create policy "public can delete episodes" on public.episodes
for delete to anon using (true);

grant select, insert, delete on public.episodes to anon;

drop policy if exists "signed in read episode files" on storage.objects;
drop policy if exists "admins upload episode files" on storage.objects;
drop policy if exists "admins update episode files" on storage.objects;
drop policy if exists "admins delete episode files" on storage.objects;
drop policy if exists "public read episode files" on storage.objects;
drop policy if exists "public upload episode files" on storage.objects;
drop policy if exists "public delete episode files" on storage.objects;

create policy "public read episode files" on storage.objects
for select to anon using (bucket_id = 'episode-files');
create policy "public upload episode files" on storage.objects
for insert to anon with check (bucket_id = 'episode-files');
create policy "public delete episode files" on storage.objects
for delete to anon using (bucket_id = 'episode-files');

grant select, insert, delete on storage.objects to anon;
