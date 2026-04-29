-- Migration: 0001_init
-- Initial schema for products and product images.

CREATE TABLE products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  price         INTEGER NOT NULL CHECK (price >= 0),
  brand         TEXT    NOT NULL,
  category      TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'private', 'on_sale', 'reserved', 'sold')),
  published_at  INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_products_status_updated ON products(status, updated_at DESC);
CREATE INDEX idx_products_brand          ON products(brand);
CREATE INDEX idx_products_category       ON products(category);

CREATE TRIGGER trg_products_touch
AFTER UPDATE ON products
FOR EACH ROW
BEGIN
  UPDATE products SET updated_at = unixepoch() WHERE id = OLD.id;
END;

CREATE TABLE product_images (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  r2_key       TEXT    NOT NULL UNIQUE,
  width        INTEGER,
  height       INTEGER,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (product_id, position)
);

CREATE INDEX idx_product_images_product ON product_images(product_id, position);
