-- Run once in the project's Supabase SQL editor. No task records or secrets here.
begin;

create table if not exists public.taskline_boards (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array'),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.taskline_history (
  owner_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  tasks jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (owner_id, revision)
);

alter table public.taskline_boards enable row level security;
alter table public.taskline_history enable row level security;
drop policy if exists "Read own board" on public.taskline_boards;
create policy "Read own board" on public.taskline_boards for select to authenticated
  using ((select auth.uid()) = owner_id);
drop policy if exists "Read own history" on public.taskline_history;
create policy "Read own history" on public.taskline_history for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on public.taskline_boards, public.taskline_history from anon, authenticated;
grant select on public.taskline_boards, public.taskline_history to authenticated;

-- The revision check and snapshot happen in one transaction. No last-writer-wins loss.
create or replace function public.save_taskline_board(expected_revision bigint, new_tasks jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid := auth.uid();
  current_board public.taskline_boards%rowtype;
  next_revision bigint;
begin
  if account_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if new_tasks is null or jsonb_typeof(new_tasks) <> 'array' or octet_length(new_tasks::text) > 5242880 then
    raise exception 'Invalid task data (maximum 5 MB)' using errcode = '22023';
  end if;
  -- Locks even when the account has not created its first board yet.
  perform pg_advisory_xact_lock(hashtextextended(account_id::text, 0));
  select * into current_board from public.taskline_boards where owner_id = account_id for update;
  if coalesce(current_board.revision, 0) is distinct from expected_revision then
    raise exception 'Tasks changed on another computer' using errcode = '40001';
  end if;
  if current_board.owner_id is not null then
    insert into public.taskline_history(owner_id, revision, tasks)
      values (account_id, current_board.revision, current_board.tasks);
  end if;
  next_revision := expected_revision + 1;
  insert into public.taskline_boards(owner_id, tasks, revision, updated_at)
    values (account_id, new_tasks, next_revision, now())
    on conflict (owner_id) do update set tasks = excluded.tasks, revision = excluded.revision, updated_at = excluded.updated_at;
  delete from public.taskline_history where owner_id = account_id and revision not in
    (select revision from public.taskline_history where owner_id = account_id order by revision desc limit 20);
  return next_revision;
end;
$$;

revoke all on function public.save_taskline_board(bigint, jsonb) from public, anon;
grant execute on function public.save_taskline_board(bigint, jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'taskline_boards') then
    alter publication supabase_realtime add table public.taskline_boards;
  end if;
end $$;
commit;
