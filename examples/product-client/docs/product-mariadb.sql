-- Fresh tutorial table only. Existing Snack tables: inspect their schema first.
CREATE TABLE IF NOT EXISTS snack (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price INT UNSIGNED NOT NULL,
  memo TEXT NULL,
  image_path VARCHAR(255) NULL,
  INDEX idx_snack_price_id (price, id),
  CHECK (price <= 1000000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
