-- Profiles (one per auth user, public username)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row when someone signs up
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Scores (one row per "cleared all levels" run; lower total_moves is better)
create table public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  total_moves integer not null check (total_moves > 0),
  created_at timestamptz not null default now()
);

alter table public.scores enable row level security;

create policy "Scores are viewable by everyone"
  on public.scores for select
  using (true);

create policy "Users can insert their own scores"
  on public.scores for insert
  with check (auth.uid() = user_id);

create index scores_user_id_idx on public.scores(user_id);
create index scores_total_moves_idx on public.scores(total_moves);

-- Each player's personal best, for the global leaderboard
create view public.leaderboard as
select p.id as user_id, p.username, min(s.total_moves) as best_total_moves
from public.scores s
join public.profiles p on p.id = s.user_id
group by p.id, p.username
order by best_total_moves asc;

-- Friendships (directional request, accepted once the addressee confirms)
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

alter table public.friendships enable row level security;

create policy "Users can view their own friendships"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

create policy "Users can respond to requests sent to them"
  on public.friendships for update
  using (auth.uid() = addressee_id);

create policy "Users can remove their own friendships"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Helper: the current user's accepted friend ids (client filters `leaderboard` by this)
create function public.my_friend_ids()
returns setof uuid as $$
  select case when requester_id = auth.uid() then addressee_id else requester_id end
  from public.friendships
  where status = 'accepted' and (requester_id = auth.uid() or addressee_id = auth.uid());
$$ language sql stable security definer set search_path = public;
