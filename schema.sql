-- TUNG TUNG+ - run in Supabase Dashboard > SQL Editor
-- Create a PRIVATE Storage bucket named episode-files before testing uploads.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('viewer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '',
  episode_number integer,
  video_path text not null,
  cover_path text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists episodes_created_at_idx on public.episodes(created_at desc);

alter table public.profiles enable row level security;
alter table public.episodes enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles(id, role) values(new.id, 'viewer') on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists(select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "read own profile or admin" on public.profiles;
create policy "read own profile or admin" on public.profiles
for select to authenticated using (id = (select auth.uid()) or public.is_admin());
-- No client insert/update/delete policy on profiles: viewers cannot promote themselves.

drop policy if exists "signed in can read episodes" on public.episodes;
create policy "signed in can read episodes" on public.episodes
for select to authenticated using (true);

drop policy if exists "admins insert episodes" on public.episodes;
create policy "admins insert episodes" on public.episodes
for insert to authenticated with check (public.is_admin() and created_by = (select auth.uid()));

drop policy if exists "admins update episodes" on public.episodes;
create policy "admins update episodes" on public.episodes
for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins delete episodes" on public.episodes;
create policy "admins delete episodes" on public.episodes
for delete to authenticated using (public.is_admin());

drop policy if exists "signed in read episode files" on storage.objects;
create policy "signed in read episode files" on storage.objects
for select to authenticated using (bucket_id = 'episode-files');

drop policy if exists "admins upload episode files" on storage.objects;
create policy "admins upload episode files" on storage.objects
for insert to authenticated with check (bucket_id = 'episode-files' and public.is_admin());

drop policy if exists "admins update episode files" on storage.objects;
create policy "admins update episode files" on storage.objects
for update to authenticated using (bucket_id = 'episode-files' and public.is_admin())
with check (bucket_id = 'episode-files' and public.is_admin());

drop policy if exists "admins delete episode files" on storage.objects;
create policy "admins delete episode files" on storage.objects
for delete to authenticated using (bucket_id = 'episode-files' and public.is_admin());

-- After registering YOUR account in the app, run this separately,
-- replacing the email below with your exact account email:
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'YOUR_EMAIL_HERE');
