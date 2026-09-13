-- Target setup for aidot-express with DB_TYPE=sqlite. Not a named-query file.
CREATE TABLE IF NOT EXISTS note (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL
);
CREATE INDEX IF NOT EXISTS idx_note_created ON note (created_at);
