
 --file-text "-- ============================================================================
-- LIBRARIA — full Supabase schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Idempotent: safe to re-run.
-- ============================================================================

-- Extensions
create extension if not exists "pgcrypto";

-- =================== TABLES ===================

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  email       text,
  student_id  text,
  department  text,
  avatar_url  text,
  is_admin    boolean default false,
  created_at  timestamptz default now()
);

create table if not exists books (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  author           text,
  domain           text,
  shelf_location   text,
  description      text,
  cover_url        text,
  ebook_url        text,
  total_copies     int default 1,
  available_copies int default 1,
  avg_rating       numeric(2,1),
  created_at       timestamptz default now()
);

create table if not exists borrow_requests (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid references books(id) on delete cascade,
  user_id     uuid references profiles(id) on delete cascade,
  unique_code text unique not null,
  status      text default 'pending',  -- pending | approved | rejected
  created_at  timestamptz default now()
);

-- Ensure the foreign key constraint for `user_id` is present and safe to re-run.
alter table borrow_requests drop constraint if exists borrow_requests_user_id_fkey;
alter table borrow_requests add constraint borrow_requests_user_id_fkey
  foreign key (user_id) references profiles(id) on delete cascade;

create table if not exists borrowings (
  id          uuid primary key default gen_random_uuid(),
  book_id     uuid references books(id) on delete cascade,
  user_id     uuid references profiles(id) on delete cascade,
  borrowed_at timestamptz default now(),
  due_date    date not null,
  returned_at timestamptz
);

-- Ensure foreign key constraint for `borrowings.user_id` is present and safe to re-run.
alter table borrowings drop constraint if exists borrowings_user_id_fkey;
alter table borrowings add constraint borrowings_user_id_fkey
  foreign key (user_id) references profiles(id) on delete cascade;

create table if not exists fines (
  id            uuid primary key default gen_random_uuid(),
  borrowing_id  uuid references borrowings(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  amount        numeric(10,2) not null,
  paid          boolean default false,
  paid_at       timestamptz,
  created_at    timestamptz default now()
);

create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid references books(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  rating     int check (rating between 1 and 5),
  comment    text,
  created_at timestamptz default now()
);

create table if not exists notices (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  message     text,
  created_at  timestamptz default now()
);

-- =================== HELPER RPCs ===================

create or replace function increment_available(book_id_in uuid)
returns void language sql as $$
  update books set available_copies = available_copies + 1 where id = book_id_in;
$$;

create or replace function decrement_available(book_id_in uuid)
returns void language sql as $$
  update books set available_copies = greatest(available_copies - 1, 0) where id = book_id_in;
$$;

-- Auto-update avg_rating whenever a review changes
create or replace function refresh_book_rating()
returns trigger language plpgsql as $$
begin
  update books b
    set avg_rating = (select round(avg(rating)::numeric, 1) from reviews where book_id = b.id)
    where b.id = coalesce(new.book_id, old.book_id);
  return null;
end$$;
drop trigger if exists trg_refresh_rating on reviews;
create trigger trg_refresh_rating
after insert or update or delete on reviews
for each row execute function refresh_book_rating();

-- Auto-create a profile row when a new auth user is created (e.g. Google sign-in)
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, full_name, email)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'full_name', new.email),
          new.email)
  on conflict (id) do nothing;
  return new;
end$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function handle_new_user();

-- =================== ROW-LEVEL SECURITY ===================

alter table profiles        enable row level security;
alter table books           enable row level security;
alter table borrow_requests enable row level security;
alter table borrowings      enable row level security;
alter table fines           enable row level security;
alter table reviews         enable row level security;

-- helper: is current user admin?
create or replace function is_admin() returns boolean
language sql stable security definer as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- ---- profiles ----
drop policy if exists "self read"         on profiles;
drop policy if exists "self update"       on profiles;
drop policy if exists "self insert"       on profiles;
drop policy if exists "admin read all"    on profiles;
drop policy if exists "admin update all"  on profiles;
create policy "self read"        on profiles for select using (auth.uid() = id);
create policy "self update"      on profiles for update using (auth.uid() = id);
create policy "self insert"      on profiles for insert with check (auth.uid() = id);
create policy "admin read all"   on profiles for select using (is_admin());
create policy "admin update all" on profiles for update using (is_admin());

-- ---- books ----
drop policy if exists "books read"   on books;
drop policy if exists "books write"  on books;
create policy "books read"  on books for select using (auth.role() = 'authenticated');
create policy "books write" on books for all    using (is_admin()) with check (is_admin());

-- ---- borrow_requests ----
drop policy if exists "br own read"     on borrow_requests;
drop policy if exists "br own insert"   on borrow_requests;
drop policy if exists "br admin all"    on borrow_requests;
drop policy if exists "br own delete"   on borrow_requests;
create policy "br own read"   on borrow_requests for select using (auth.uid() = user_id);
create policy "br own insert" on borrow_requests for insert with check (auth.uid() = user_id);
create policy "br admin all"  on borrow_requests for all    using (is_admin()) with check (is_admin());

-- allow users to DELETE their own borrow requests (so cancel button can remove pending requests)
create policy "br own delete" on borrow_requests for delete using (auth.uid() = user_id);

-- ---- borrowings ----
drop policy if exists "borrow own read"  on borrowings;
drop policy if exists "borrow admin all" on borrowings;
create policy "borrow own read"  on borrowings for select using (auth.uid() = user_id);
create policy "borrow admin all" on borrowings for all    using (is_admin()) with check (is_admin());

-- ---- fines ----
drop policy if exists "fines own read"   on fines;
drop policy if exists "fines own pay"    on fines;
drop policy if exists "fines admin all"  on fines;
create policy "fines own read"  on fines for select using (auth.uid() = user_id);
create policy "fines own pay"   on fines for update using (auth.uid() = user_id);
create policy "fines admin all" on fines for all    using (is_admin()) with check (is_admin());

-- ---- reviews ----
drop policy if exists "rev read all"    on reviews;
drop policy if exists "rev own write"   on reviews;
create policy "rev read all"  on reviews for select using (auth.role() = 'authenticated');
create policy "rev own write" on reviews for all    using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---- notices ----
drop policy if exists "notices read"    on notices;
drop policy if exists "notices write"   on notices;
create policy "notices read"  on notices for select using (auth.role() = 'authenticated');
create policy "notices write" on notices for all    using (is_admin()) with check (is_admin());

-- =================== STORAGE BUCKETS ===================

insert into storage.buckets (id, name, public)
values ('book-covers',    'book-covers',    true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', true)
on conflict (id) do nothing;

-- Allow public read on both buckets
drop policy if exists "Public read book-covers"    on storage.objects;
drop policy if exists "Public read student-photos" on storage.objects;
create policy "Public read book-covers"
  on storage.objects for select using (bucket_id = 'book-covers');
create policy "Public read student-photos"
  on storage.objects for select using (bucket_id = 'student-photos');

-- Authenticated users can upload to either bucket
drop policy if exists "Auth upload book-covers"    on storage.objects;
drop policy if exists "Auth upload student-photos" on storage.objects;
create policy "Auth upload book-covers"
  on storage.objects for insert
  with check (bucket_id = 'book-covers' and auth.role() = 'authenticated');
create policy "Auth upload student-photos"
  on storage.objects for insert
  with check (bucket_id = 'student-photos' and auth.role() = 'authenticated');

-- Users can update / delete their own uploaded files
drop policy if exists "Owner update"  on storage.objects;
drop policy if exists "Owner delete"  on storage.objects;
create policy "Owner update" on storage.objects for update using (auth.uid() = owner);
create policy "Owner delete" on storage.objects for delete using (auth.uid() = owner);

-- ============================================================================
-- DONE. Now go to docs/SUPABASE_SETUP.md step 6 to make yourself admin.
-- ============================================================================
