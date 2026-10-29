-- The marketplace: players sell raw copies of their cards for coins. A
-- listed copy leaves the seller's collection at once (held by the listing)
-- and goes to the buyer, or back to the seller when the listing is
-- cancelled or runs out. Every sale is kept, for price history.

CREATE TABLE market_listings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id     text NOT NULL,
  foil        boolean NOT NULL,
  qty         integer NOT NULL CHECK (qty >= 0),
  price       integer NOT NULL CHECK (price > 0),       -- coins per copy
  status      text NOT NULL DEFAULT 'active',           -- active | sold | cancelled | expired
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX market_active ON market_listings(card_id, foil, price) WHERE status = 'active';
CREATE INDEX market_seller ON market_listings(seller, status);

CREATE TABLE market_sales (
  id          bigserial PRIMARY KEY,
  listing_id  uuid NOT NULL REFERENCES market_listings(id) ON DELETE CASCADE,
  buyer       uuid REFERENCES users(id) ON DELETE SET NULL,
  seller      uuid REFERENCES users(id) ON DELETE SET NULL,
  card_id     text NOT NULL,
  foil        boolean NOT NULL,
  qty         integer NOT NULL,
  price       integer NOT NULL,
  fee         integer NOT NULL,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_sales_card ON market_sales(card_id, foil, at DESC);
