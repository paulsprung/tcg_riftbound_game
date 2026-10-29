-- Online play: ratings per mode, finished matches with their records, and
-- the games in progress (their record so far), so a restart picks them up.

CREATE TABLE ratings (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode     text NOT NULL,                     -- 'ranked' | 'casual'
  r        double precision NOT NULL DEFAULT 1500,
  rd       double precision NOT NULL DEFAULT 350,
  vol      double precision NOT NULL DEFAULT 0.06,
  games    integer NOT NULL DEFAULT 0,
  wins     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, mode)
);
CREATE INDEX ratings_ladder ON ratings(mode, (r - 2 * rd) DESC);

CREATE TABLE matches (
  id          uuid PRIMARY KEY,
  mode        text NOT NULL,
  players     uuid[] NOT NULL,                -- seat 0, seat 1
  winner      smallint,                       -- the seat; null for a draw
  reason      text NOT NULL,
  turns       integer NOT NULL,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz NOT NULL DEFAULT now(),
  record      jsonb NOT NULL,                 -- replays the game (setup and every answer)
  outcome     jsonb NOT NULL DEFAULT '{}'     -- rating changes and coins, per seat
);
CREATE INDEX matches_p0 ON matches((players[1]), ended_at DESC);
CREATE INDEX matches_p1 ON matches((players[2]), ended_at DESC);

CREATE TABLE live_games (
  id          uuid PRIMARY KEY,
  mode        text NOT NULL,
  players     uuid[] NOT NULL,
  data        jsonb NOT NULL,                 -- the record so far, names, deck names
  started_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
