-- The account's economy, kept by the server: coins, cards, packs, graded
-- slabs, the showcase and the decks. The browser only shows it; every
-- change goes through the API (server/economy.ts), each in a transaction
-- that locks the account row first.

ALTER TABLE users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

CREATE TABLE accounts (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins          integer NOT NULL DEFAULT 0 CHECK (coins >= 0),
  starter        text,
  daily_at       timestamptz,
  tutorial_done  boolean NOT NULL DEFAULT false,
  showcase       jsonb NOT NULL DEFAULT '[]'
);

-- raw copies of a printing (cards.json Card id)
CREATE TABLE owned_cards (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id  text NOT NULL,
  normal   integer NOT NULL DEFAULT 0 CHECK (normal >= 0),
  foil     integer NOT NULL DEFAULT 0 CHECK (foil >= 0),
  PRIMARY KEY (user_id, card_id)
);

-- unopened boosters, and how many of each set were opened
CREATE TABLE owned_packs (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id   text NOT NULL,
  n        integer NOT NULL DEFAULT 0 CHECK (n >= 0),
  opened   integer NOT NULL DEFAULT 0 CHECK (opened >= 0),
  PRIMARY KEY (user_id, set_id)
);

CREATE TABLE slabs (
  cert       text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id    text NOT NULL,
  data       jsonb NOT NULL,
  graded_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slabs_user ON slabs(user_id);

CREATE TABLE decks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX decks_user ON decks(user_id);

-- Every coin and pack that comes or goes, with why and, for an admin's
-- grant, who gave it. Never updated, only added to.
CREATE TABLE ledger (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  coins       integer NOT NULL DEFAULT 0,
  packs       jsonb,
  reason      text NOT NULL,
  actor       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user ON ledger(user_id, created_at DESC);
