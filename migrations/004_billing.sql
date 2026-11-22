-- Paid membership through Stripe. Card and billing details stay with Stripe;
-- only its ids and the state of the subscription are kept here.
alter table users
  add column stripe_customer_id text unique,
  add column stripe_subscription_id text,
  add column subscription_status text,              -- Stripe's status: active, trialing, past_due, canceled, ...
  add column subscription_interval text,            -- 'month' | 'year'
  add column subscription_period_end timestamptz,
  add column subscription_cancel_at_period_end boolean not null default false;

-- Webhook events already handled, so a redelivery is not applied twice.
create table stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);
