-- Tournaments: an admin makes one, players sign up with a deck (locked from
-- then on, as a decklist), the server runs Swiss rounds and a top cut, plays
-- each match as online games and hands out the prizes.

CREATE TABLE tournaments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'open',    -- open | running | done | cancelled
  settings    jsonb NOT NULL,                  -- bestOf, maxPlayers, entryFee, topCut, rounds, prizes
  starts_at   timestamptz NOT NULL,
  round       integer NOT NULL DEFAULT 0,
  stage       text NOT NULL DEFAULT 'swiss',   -- swiss | top
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX tournaments_status ON tournaments(status, starts_at);

CREATE TABLE tournament_players (
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  deck_ref       text NOT NULL,
  deck           jsonb NOT NULL,
  dropped        boolean NOT NULL DEFAULT false,
  final_rank     integer,
  joined_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE tournament_matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round          integer NOT NULL,
  stage          text NOT NULL,                -- swiss | top
  tbl            integer NOT NULL,             -- the table number in its round
  a              uuid NOT NULL REFERENCES users(id),
  b              uuid REFERENCES users(id),    -- null: a bye
  wins           integer[] NOT NULL DEFAULT '{0,0}',
  games          integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'pending',  -- pending | playing | done
  game_id        uuid
);
CREATE INDEX tournament_matches_t ON tournament_matches(tournament_id, round);
