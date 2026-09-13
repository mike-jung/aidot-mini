-- Create the table used by the Note example.
CREATE TABLE IF NOT EXISTS note (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  title      VARCHAR(200) NOT NULL,
  body       TEXT,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_note_created ON note (created_at);

INSERT INTO note (title, body)
SELECT '첫 메모', 'aidot-mini 가 정상 동작합니다.'
WHERE NOT EXISTS (SELECT 1 FROM note);
