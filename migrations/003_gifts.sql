-- Gifted membership, granted to an email address (npm run gift). It attaches to
-- the account with that address the first time it is seen, and the days count from then.
create table gifts (
  id bigserial primary key,
  email text not null,
  days integer not null default 365,
  note text,
  created_at timestamptz not null default now(),
  redeemed_by uuid references users(id) on delete cascade,
  redeemed_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index gifts_email on gifts (email) where redeemed_by is null;
create index gifts_user on gifts (redeemed_by);
