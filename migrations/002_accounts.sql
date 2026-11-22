-- Accounts: who a user is, how they sign in, and what they agreed to.
alter table users
  add column email text unique,                 -- lower-cased; null only for data imported before sign-in existed
  add column accepted_terms_at timestamptz,     -- null until the consent step is done
  add column terms_version text,
  add column age_confirmed_at timestamptz,
  add column marketing_opt_in boolean not null default false;

-- One row per way of signing in. provider 'email' is a magic link, with the address as subject.
create table identities (
  provider text not null,
  subject text not null,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (provider, subject)
);
create index identities_user on identities (user_id);

-- Only the hash of a session id is stored; the id itself lives in the browser cookie.
create table sessions (
  id_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user on sessions (user_id);

-- Single-use emailed links: 'login' to sign in, 'change_email' to confirm a new address.
create table login_tokens (
  token_hash text primary key,
  email text not null,
  purpose text not null default 'login',
  user_id uuid references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index login_tokens_email on login_tokens (email, created_at);

-- Append-only record of every consent given or withdrawn, with the wording version shown.
create table consents (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,          -- 'terms' | 'age' | 'marketing'
  granted boolean not null,
  version text not null,
  source text not null,        -- 'signup' | 'settings' | 'unsubscribe_link'
  at timestamptz not null default now()
);
create index consents_user on consents (user_id, at);
