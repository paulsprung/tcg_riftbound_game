-- The raw copies move into the account row: one compressed jsonb per
-- player ({ "<card id>": [normal, foil] }) instead of a row per printing.
-- Measured with 2,000 players of 400 printings each: 115 MB as rows, 4 MB as
-- jsonb. The account row is locked for every change anyway.

ALTER TABLE accounts ADD COLUMN cards jsonb NOT NULL DEFAULT '{}';

UPDATE accounts a SET cards = c.cards
FROM (
  SELECT user_id, jsonb_object_agg(card_id, jsonb_build_array(normal, foil)) AS cards
  FROM owned_cards WHERE normal > 0 OR foil > 0 GROUP BY user_id
) c
WHERE c.user_id = a.user_id;

DROP TABLE owned_cards;
