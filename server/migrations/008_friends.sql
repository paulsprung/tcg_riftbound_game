-- Friends: a request by friend code (Discord names are not unique, and a
-- code can't be guessed by browsing), accepted or declined by the other.
-- One row per pair, the smaller id first.

ALTER TABLE users ADD COLUMN friend_code text UNIQUE;

CREATE TABLE friendships (
  user_a        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending',    -- pending | accepted
  requested_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX friendships_b ON friendships(user_b);
