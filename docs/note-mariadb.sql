-- Target setup in the database selected by the aidot-express host.
CREATE TABLE IF NOT EXISTS note (
  id BIGINT NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  body TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  PRIMARY KEY (id),
  INDEX idx_note_created (created_at)
);
