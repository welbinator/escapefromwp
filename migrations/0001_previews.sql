-- Preview-builder: one row per lead's preview set. Three template variants are
-- addressed by URL (/preview/<id>/<template>), NOT by separate deployments —
-- a "site" is a D1 row + R2 objects, so cleanup is a row+object delete.

CREATE TABLE IF NOT EXISTS ec_previews (
  id              TEXT PRIMARY KEY,          -- 32-hex public token (used in URLs)
  business_name   TEXT,
  source_url      TEXT NOT NULL,             -- the WordPress site we built from
  input_method    TEXT NOT NULL,            -- 'rest' | 'wxr'
  email           TEXT NOT NULL,             -- where the 3 links were sent
  -- brand kit (auto-grabbed; may be null → template falls back to wordmark)
  logo_key        TEXT,                      -- R2 key of grabbed logo, or null
  brand_primary   TEXT,                      -- hex, e.g. #1a73e8
  brand_secondary TEXT,
  brand_text      TEXT,                      -- readable text color on primary
  -- content lives in R2 as previews/<id>/content.json (manifest) — keep D1 lean
  content_key     TEXT NOT NULL,
  total_entries   INTEGER DEFAULT 0,
  -- lifecycle
  status          TEXT NOT NULL DEFAULT 'live',  -- live | liked | dead
  dead_variants   TEXT DEFAULT '',           -- comma-joined variants rejected via "Not for me"; preview flips to 'dead' only when ALL are rejected
  liked_variant   TEXT,                      -- warm|bold|editorial they chose
  lead_name       TEXT,
  lead_message    TEXT,
  created_at      TEXT NOT NULL,
  liked_at        TEXT,
  -- abuse controls
  ip_hash         TEXT,
  is_spam         INTEGER DEFAULT 0,
  spam_reason     TEXT
);

CREATE INDEX IF NOT EXISTS idx_previews_status_created
  ON ec_previews (status, created_at);
CREATE INDEX IF NOT EXISTS idx_previews_ip_created
  ON ec_previews (ip_hash, created_at);
