-- Per-user storage: what used to live in data/progress.json and data/games/.
create table users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Settings, missions and events: one document per user, changed as a whole.
create table progress (
  user_id uuid primary key references users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Games trimmed to their opening. The verdict is per user: the same chess.com
-- game can belong to two users and be judged against different missions.
create table games (
  user_id uuid not null references users(id) on delete cascade,
  uuid text not null,
  ended_at bigint not null,
  data jsonb not null,
  verdict jsonb,
  primary key (user_id, uuid)
);
create index games_user_ended on games (user_id, ended_at);

-- One row per chess.com month already fetched, with its etag for cheap re-checks.
create table archive_months (
  user_id uuid not null references users(id) on delete cascade,
  month text not null,
  etag text,
  primary key (user_id, month)
);
