-- Apply after schema.sql. Only token hashes are stored; tables stay private.
begin;
create table if not exists public.taskline_links (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  owner_id uuid not null references public.taskline_boards(owner_id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.taskline_links enable row level security;
revoke all on public.taskline_links from public, anon, authenticated;

create or replace function public.load_taskline_link(link_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid;
  result jsonb;
begin
  if link_token is null or link_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid private link' using errcode = '42501';
  end if;
  select owner_id into account_id from public.taskline_links
    where token_hash = encode(sha256(convert_to(link_token, 'UTF8')), 'hex') and revoked_at is null;
  if account_id is null then raise exception 'Private link is invalid or revoked' using errcode = '42501'; end if;
  select jsonb_build_object('tasks', tasks, 'revision', revision) into result
    from public.taskline_boards where owner_id = account_id;
  return result;
end;
$$;
create or replace function public.save_taskline_link(link_token text, expected_revision bigint, new_tasks jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  account_id uuid;
  current_board public.taskline_boards%rowtype;
  next_revision bigint;
begin
  if link_token is null or link_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid private link' using errcode = '42501';
  end if;
  select owner_id into account_id from public.taskline_links
    where token_hash = encode(sha256(convert_to(link_token, 'UTF8')), 'hex') and revoked_at is null;
  if account_id is null then raise exception 'Private link is invalid or revoked' using errcode = '42501'; end if;
  if new_tasks is null or jsonb_typeof(new_tasks) <> 'array' or octet_length(new_tasks::text) > 5242880 then
    raise exception 'Invalid task data (maximum 5 MB)' using errcode = '22023';
  end if;
  -- Locks even when the account has not created its first board yet.
  perform pg_advisory_xact_lock(hashtextextended(account_id::text, 0));
  select * into current_board from public.taskline_boards where owner_id = account_id for update;
  if coalesce(current_board.revision, 0) is distinct from expected_revision then
    raise exception 'Tasks changed on another computer' using errcode = 'PT409';
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

revoke all on function public.load_taskline_link(text) from public;
revoke all on function public.save_taskline_link(text, bigint, jsonb) from public;
grant execute on function public.load_taskline_link(text) to anon, authenticated;
grant execute on function public.save_taskline_link(text, bigint, jsonb) to anon, authenticated;
commit;
