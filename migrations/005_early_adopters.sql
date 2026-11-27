-- The first subscribers pay the early-adopter price for good (services/pricing.js).
-- One row per place, taken the first time an account subscribes at that price.
-- A place outlives its account, so deleting an account does not hand it to someone else.
create table early_adopters (
  number serial primary key,
  user_id uuid unique references users(id) on delete set null,
  claimed_at timestamptz not null default now()
);
