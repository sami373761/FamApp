-- =============================================================================
-- In-chat quick polls
--
-- "Pizza or pasta?" asked in the family chat, with the answers counted where
-- the question was asked. Two tables: the poll, and one row per member who
-- voted.
--
-- A POLL HANGS OFF A MESSAGE, THE WAY A TASK DOES.
--
-- `tasks.source_message_id` already established the shape: the chat renders a
-- message as a card when a *row in another table* names it, rather than by
-- adding a kind to `messages_type_valid`. Polls take the same route and get the
-- same property for free — lose the poll and what is left is still a readable
-- line of chat.
--
-- The difference is which message it names, and it is the honest one in both
-- cases. A task names the `system` announcement FamApp wrote about it, because
-- the member's own line is theirs and must not be redrawn as a card. A poll
-- names an ordinary `text` message whose content *is* the question, because the
-- question is what the member actually said. So a poll swept by the 30-day text
-- retention leaves "Pizza or pasta?" sitting in the conversation, which is
-- exactly what was asked.
--
-- That also fixes the write order, and inverts `createTask`'s. The message must
-- exist first, because `message_id` references it — and that is safe here for
-- the reason it was not there: a message with no poll behind it is somebody
-- asking a question, whereas an announcement with no task behind it is a claim
-- about a row that never existed.
--
-- OPTIONS ARE JSONB, AND THAT IS THE CEILING.
--
-- Between two and four strings, checked by `private.poll_options_valid()`. An
-- options *table* would be the normalised answer and buys nothing: the array is
-- never queried into, it is never edited after the insert, and a vote refers to
-- a position in it rather than to a row. What it does cost is a helper
-- function, because a CHECK constraint may not contain a subquery and
-- `jsonb_array_elements` is one.
--
-- A vote is `(poll_id, user_id)` unique, so changing your mind is an UPDATE of
-- your own row and taking it back is a DELETE. There is no "abstain" value:
-- not having voted is the absence of a row, which is what an empty result
-- already means and what the client already renders.
--
-- `family_id` is denormalised onto both tables, exactly as `locations`,
-- `messages` and `saved_places` carry it: the RLS policies filter on it without
-- a join, and the realtime channel's `family_id=eq.…` filter has nothing else
-- to match. Both are pinned by triggers, because a denormalised key is free to
-- disagree with the row it was copied from.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. What a valid set of options looks like
--
-- Defined before the table, because a check constraint is validated at creation
-- time — the same ordering rule a SQL-language function selecting from a table
-- follows. IMMUTABLE and touching nothing but its argument, which is what makes
-- it legal in a CHECK at all.
--
-- `bool_and` over an empty set is NULL and a NULL check *passes*, so the result
-- is coalesced rather than trusted to the length test above it.
-- -----------------------------------------------------------------------------
create or replace function private.poll_options_valid(p_options jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select jsonb_typeof(p_options) = 'array'
     and jsonb_array_length(p_options) between 2 and 4
     and coalesce(
           (select bool_and(
                     jsonb_typeof(o) = 'string'
                     and char_length(btrim(o #>> '{}')) between 1 and 60
                   )
              from jsonb_array_elements(p_options) o),
           false
         );
$fn$;

revoke all on function private.poll_options_valid(jsonb) from public;

comment on function private.poll_options_valid(jsonb) is
  'True for a JSON array of 2-4 non-blank strings of at most 60 characters. The whole of the options contract; a CHECK cannot hold a subquery, so it lives here.';


-- -----------------------------------------------------------------------------
-- 2. Tables
--
-- `message_id` is unique: one poll per message, which is what lets the chat
-- build its lookup the same way it builds `taskByMessageId`. It cascades,
-- because a poll whose question has been deleted or swept has nothing left to
-- be attached to — and deleting the message is therefore the whole of deleting
-- a poll, which is why there is no delete policy on this table.
-- -----------------------------------------------------------------------------
create table if not exists public.chat_polls (
  id         uuid        primary key default gen_random_uuid(),
  family_id  uuid        not null references public.families (id) on delete cascade,
  message_id uuid        not null unique
             references public.messages (id) on delete cascade,
  question   varchar(200) not null
             constraint chat_polls_question_length
             check (char_length(btrim(question)) between 1 and 200),
  options    jsonb       not null
             constraint chat_polls_options_valid
             check (private.poll_options_valid(options)),
  created_by uuid        not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.chat_polls is
  'A question asked in the family chat. Hangs off the `messages` row that carries the question text, the way tasks hang off their announcement.';
comment on column public.chat_polls.message_id is
  'The text message whose content is this question. Unique, and cascading: deleting the message is how a poll is removed.';
comment on column public.chat_polls.options is
  'JSON array of 2-4 answer strings. A vote names a position in this array, so the array is never edited after the insert.';

create table if not exists public.chat_poll_votes (
  id           uuid        primary key default gen_random_uuid(),
  poll_id      uuid        not null references public.chat_polls (id) on delete cascade,
  -- Denormalised for the RLS filter and for realtime's `family_id=eq.…`, and
  -- pinned to the poll's own family by the trigger below.
  family_id    uuid        not null references public.families (id) on delete cascade,
  option_index smallint    not null
               constraint chat_poll_votes_index_range check (option_index between 0 and 3),
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),

  -- One vote per member per poll. Changing your mind is an UPDATE of this row;
  -- taking it back is a DELETE. There is no abstain value, because not having
  -- voted is the absence of a row.
  constraint chat_poll_votes_one_per_member unique (poll_id, user_id)
);

comment on table public.chat_poll_votes is
  'One row per member per poll. No row means they have not voted — there is no abstain value.';
comment on column public.chat_poll_votes.option_index is
  'Position in chat_polls.options. Bounded against that poll''s actual length by private.check_poll_vote().';


-- -----------------------------------------------------------------------------
-- 3. Indexes
--
-- Every read is "everything in my family", which is what the policies filter on
-- too. The unique constraint already indexes `(poll_id, user_id)`, so counting
-- a poll's votes is covered.
-- -----------------------------------------------------------------------------
create index if not exists chat_polls_family_id_idx      on public.chat_polls (family_id);
create index if not exists chat_poll_votes_family_id_idx on public.chat_poll_votes (family_id);


-- -----------------------------------------------------------------------------
-- 4. A poll cannot outlive its author's membership, and cannot name somebody
--    else's message
--
-- `family_id` is copied onto the row, so it is free to disagree with the family
-- the author is actually in — the same hole `saved_places_check_family` closes.
-- The message check is the second half and is specific to this table: a poll
-- attached to a message from another family would be readable by a family that
-- cannot see the question it is counting answers to.
-- -----------------------------------------------------------------------------
create or replace function private.check_poll_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  member_family  uuid;
  message_family uuid;
begin
  select p.family_id into member_family
    from public.profiles p
   where p.id = new.created_by;

  if member_family is null or member_family is distinct from new.family_id then
    raise exception 'A poll can only be created for the family you belong to.'
      using errcode = 'P0001';
  end if;

  select m.family_id into message_family
    from public.messages m
   where m.id = new.message_id;

  if message_family is distinct from new.family_id then
    raise exception 'A poll must be attached to a message in the same family.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

revoke all on function private.check_poll_family() from public;

drop trigger if exists chat_polls_check_family on public.chat_polls;

create trigger chat_polls_check_family
  before insert or update on public.chat_polls
  for each row execute function private.check_poll_family();


-- -----------------------------------------------------------------------------
-- 5. A vote belongs to its poll's family, and to an option that exists
--
-- The range check on the column bounds `option_index` at the widest a poll may
-- be; this bounds it at the width of *this* poll, which the column cannot know.
-- The family is taken from the poll rather than verified against what the
-- client sent, so a caller cannot file a vote under a family it does not belong
-- to by writing a different id.
-- -----------------------------------------------------------------------------
create or replace function private.check_poll_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_family  uuid;
  v_options integer;
begin
  select cp.family_id, jsonb_array_length(cp.options)
    into v_family, v_options
    from public.chat_polls cp
   where cp.id = new.poll_id;

  if v_family is null then
    raise exception 'That poll no longer exists.' using errcode = 'P0001';
  end if;

  -- Taken, not checked: the poll decides which family its votes belong to.
  new.family_id := v_family;

  if new.option_index >= v_options then
    raise exception 'That poll has no option %.', new.option_index using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

revoke all on function private.check_poll_vote() from public;

drop trigger if exists chat_poll_votes_check on public.chat_poll_votes;

create trigger chat_poll_votes_check
  before insert or update on public.chat_poll_votes
  for each row execute function private.check_poll_vote();


-- -----------------------------------------------------------------------------
-- 6. Row level security
--
-- Reads are family-wide on both tables — a poll everybody can answer is a poll
-- everybody can see the answers to, and hiding the tally would make the feature
-- pointless. Writes are the author's own, which is the split `messages` and
-- `saved_places` already use.
--
-- `chat_polls` has no UPDATE and no DELETE policy, and that is the design
-- rather than an omission: the options array is what votes index into, so
-- editing it would silently re-label answers people had already given, and
-- removing a poll is done by deleting the message it hangs off (which cascades
-- and is governed by `messages: delete own or admin`).
--
-- Note the shape of the vote UPDATE policy: `using` and `with check` both name
-- `user_id`, because an UPDATE re-checks the SELECT policy against the *new*
-- row. Moving a vote out of your own family would move it out of your own
-- visibility, and no `with check` can rescue that.
-- -----------------------------------------------------------------------------
alter table public.chat_polls      enable row level security;
alter table public.chat_poll_votes enable row level security;

drop policy if exists "chat_polls: family reads" on public.chat_polls;
drop policy if exists "chat_polls: insert own"   on public.chat_polls;

create policy "chat_polls: family reads"
  on public.chat_polls for select to authenticated
  using (family_id = (select private.current_family_id()));

create policy "chat_polls: insert own"
  on public.chat_polls for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and family_id = (select private.current_family_id())
  );

drop policy if exists "chat_poll_votes: family reads" on public.chat_poll_votes;
drop policy if exists "chat_poll_votes: insert own"   on public.chat_poll_votes;
drop policy if exists "chat_poll_votes: update own"   on public.chat_poll_votes;
drop policy if exists "chat_poll_votes: delete own"   on public.chat_poll_votes;

create policy "chat_poll_votes: family reads"
  on public.chat_poll_votes for select to authenticated
  using (family_id = (select private.current_family_id()));

create policy "chat_poll_votes: insert own"
  on public.chat_poll_votes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and family_id = (select private.current_family_id())
  );

create policy "chat_poll_votes: update own"
  on public.chat_poll_votes for update to authenticated
  using      (user_id = (select auth.uid()) and family_id = (select private.current_family_id()))
  with check (user_id = (select auth.uid()) and family_id = (select private.current_family_id()));

create policy "chat_poll_votes: delete own"
  on public.chat_poll_votes for delete to authenticated
  using (user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- 7. Least privilege
--
-- Supabase grants ALL on a new `public` table to `anon` and `authenticated` at
-- creation time — TRUNCATE included, which RLS does not restrain. `anon` had
-- its default privileges revoked in 20260730120300; `authenticated` is cut back
-- to the verbs each table's policies actually allow, so the grant and the
-- policy set say the same thing.
-- -----------------------------------------------------------------------------
revoke all on public.chat_polls      from anon;
revoke all on public.chat_polls      from authenticated;
revoke all on public.chat_poll_votes from anon;
revoke all on public.chat_poll_votes from authenticated;

grant select, insert                         on public.chat_polls      to authenticated;
grant select, insert, update, delete         on public.chat_poll_votes to authenticated;


-- -----------------------------------------------------------------------------
-- 8. Realtime
--
-- A poll whose count only moves on a pull-to-refresh is not a poll, so votes
-- are the point of this section. `replica identity full` on the votes table is
-- what makes *retracting* a vote deliverable: a DELETE is published as the old
-- row and the `family_id=eq.…` filter is matched against it, so the default
-- identity — the primary key alone — would send nothing the channel could
-- match, and the tally would only fall on the next reload.
--
-- `chat_polls` is published for its INSERT alone. It needs no replica identity:
-- a poll is never updated (see the policies above) and is removed only by its
-- message being deleted, which the client already hears about on the `messages`
-- channel and answers by dropping the card.
-- -----------------------------------------------------------------------------
alter table public.chat_poll_votes replica identity full;

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_polls'
    ) then
      alter publication supabase_realtime add table public.chat_polls;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_poll_votes'
    ) then
      alter publication supabase_realtime add table public.chat_poll_votes;
    end if;
  end if;
end;
$realtime$;
