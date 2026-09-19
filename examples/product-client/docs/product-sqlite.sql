-- Fresh tutorial workspace only. Keep existing tutorial schema/migrations intact.
CREATE TABLE IF NOT EXISTS snack (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0 AND price <= 1000000),
  memo TEXT,
  image_path VARCHAR(255) NULL
);
CREATE INDEX IF NOT EXISTS idx_snack_price_id ON snack (price, id);
