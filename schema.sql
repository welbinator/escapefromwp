CREATE TABLE IF NOT EXISTS ec_contact_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  site TEXT,
  message TEXT,
  is_spam INTEGER NOT NULL DEFAULT 0,
  spam_reason TEXT,
  created_at TEXT NOT NULL
);
