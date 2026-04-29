-- Migration: 0002_add_product_info_fields
-- Add optional free-form fields surfaced in the "商品の情報" block on the item detail page.

ALTER TABLE products ADD COLUMN size            TEXT;
ALTER TABLE products ADD COLUMN condition       TEXT;
ALTER TABLE products ADD COLUMN purchase_period TEXT;
