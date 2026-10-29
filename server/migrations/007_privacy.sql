-- Deleting an account (GDPR art. 17): one row stands in for every deleted
-- player in other players' history (tournament pairings, match lists), so
-- their results stay whole without anything that points to the person.
INSERT INTO users (id, discord_id, name) VALUES ('00000000-0000-0000-0000-000000000000', 'deleted', 'Deleted player')
ON CONFLICT DO NOTHING;

-- a sale stays in the buyer's history when the seller's account (and so the listing) is deleted
ALTER TABLE market_sales ALTER COLUMN listing_id DROP NOT NULL;
ALTER TABLE market_sales DROP CONSTRAINT market_sales_listing_id_fkey;
ALTER TABLE market_sales ADD CONSTRAINT market_sales_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES market_listings(id) ON DELETE SET NULL;
