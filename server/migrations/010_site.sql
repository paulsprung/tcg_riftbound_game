-- What admins put on Home: the news column and the banner's words (server/site.ts).

CREATE TABLE site_news (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag         text NOT NULL,
  tone        text NOT NULL CHECK (tone IN ('purple', 'green', 'gold', 'teal', 'red')),
  title       text NOT NULL,
  body        text NOT NULL,
  position    integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);

-- one row per setting; 'home' holds the banner
CREATE TABLE site_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
