-- Two cards Riot renamed (typos fixed): Sky Crusier is Sky Cruiser, Corinna Veraza is Corina Veraza.
-- Saved decks name cards by the slug of their name; they follow.

UPDATE decks SET body = replace(replace(body::text, '"sky-crusier"', '"sky-cruiser"'), '"corinna-veraza"', '"corina-veraza"')::jsonb
  WHERE body::text LIKE '%sky-crusier%' OR body::text LIKE '%corinna-veraza%';
UPDATE tournament_players SET deck = replace(replace(deck::text, '"sky-crusier"', '"sky-cruiser"'), '"corinna-veraza"', '"corina-veraza"')::jsonb
  WHERE deck::text LIKE '%sky-crusier%' OR deck::text LIKE '%corinna-veraza%';
