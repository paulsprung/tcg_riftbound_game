-- Limited play (Tournament Rules 602): a player's Sealed or Draft pool, the
-- draft that makes it (a pod with seven computer seats for casual play), the
-- deck built from it. A tournament's pools carry its id; casual pools are
-- dropped after a while (privacy.ts retention).

CREATE TABLE limited_pools (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  format         text NOT NULL CHECK (format IN ('sealed', 'draft')),
  set_id         text NOT NULL,
  cards          jsonb NOT NULL DEFAULT '[]',
  draft          jsonb,
  deck           jsonb,
  tournament_id  uuid REFERENCES tournaments(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX limited_pools_user ON limited_pools(user_id, created_at DESC);
CREATE UNIQUE INDEX limited_pools_tournament ON limited_pools(tournament_id, user_id) WHERE tournament_id IS NOT NULL;

-- a Limited tournament drafts (pods, picks, the pick clock) and builds (until a deadline) before its rounds
ALTER TABLE tournaments ADD COLUMN draft jsonb, ADD COLUMN build_until timestamptz;
