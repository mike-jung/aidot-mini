CREATE TABLE IF NOT EXISTS demo_product (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    memo TEXT,
    image_path TEXT
);
