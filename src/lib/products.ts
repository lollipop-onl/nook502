/**
 * Product / product image data access layer.
 *
 * Thin repository over D1. We deliberately keep the interface narrow — pages
 * call these functions directly, and image upload coordinates with R2 in the
 * caller (see `src/lib/images.ts`) so that R2 lifecycle stays explicit.
 */
import type { ProductStatus } from "./status";
import { isProductStatus, PUBLIC_STATUSES } from "./status";

export interface ProductImage {
  id: number;
  product_id: number;
  r2_key: string;
  width: number | null;
  height: number | null;
  position: number;
}

export interface Product {
  id: number;
  title: string;
  description: string;
  price: number;
  brand: string;
  category: string;
  status: ProductStatus;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProductWithImages extends Product {
  images: ProductImage[];
}

interface ProductRow {
  id: number;
  title: string;
  description: string;
  price: number;
  brand: string;
  category: string;
  status: string;
  published_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ImageRow {
  id: number;
  product_id: number;
  r2_key: string;
  width: number | null;
  height: number | null;
  position: number;
}

function rowToProduct(row: ProductRow): Product {
  if (!isProductStatus(row.status)) {
    throw new Error(`Invalid status in DB row: ${row.status}`);
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    brand: row.brand,
    category: row.category,
    status: row.status,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const SELECT_PRODUCT =
  "SELECT id, title, description, price, brand, category, status, published_at, created_at, updated_at FROM products";

const SELECT_IMAGE = "SELECT id, product_id, r2_key, width, height, position FROM product_images";

export interface ListOptions {
  status?: ProductStatus | "all";
  /** When true, restrict to publicly browsable statuses regardless of `status`. */
  publicOnly?: boolean;
  limit?: number;
}

/**
 * Fetch products with their first image (used as thumbnail in lists).
 * Sorted by status priority then most recently updated.
 */
export async function listProductsWithCover(
  db: D1Database,
  opts: ListOptions = {},
): Promise<Array<Product & { cover: ProductImage | null }>> {
  const where: string[] = [];
  const binds: Array<string | number> = [];

  if (opts.publicOnly) {
    where.push(`status IN (${PUBLIC_STATUSES.map(() => "?").join(",")})`);
    binds.push(...PUBLIC_STATUSES);
  } else if (opts.status && opts.status !== "all") {
    where.push("status = ?");
    binds.push(opts.status);
  }

  const limitClause = opts.limit ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : "";
  const sql = `${SELECT_PRODUCT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
    ORDER BY
      CASE status
        WHEN 'on_sale'  THEN 1
        WHEN 'reserved' THEN 2
        WHEN 'draft'    THEN 3
        WHEN 'private'  THEN 4
        WHEN 'sold'     THEN 5
        ELSE 99
      END,
      updated_at DESC${limitClause}`;

  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<ProductRow>();
  const products = (result.results ?? []).map(rowToProduct);
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);
  const placeholders = ids.map(() => "?").join(",");
  const imgs = await db
    .prepare(`${SELECT_IMAGE} WHERE product_id IN (${placeholders}) AND position = 0`)
    .bind(...ids)
    .all<ImageRow>();

  const coverByProduct = new Map<number, ProductImage>();
  for (const row of imgs.results ?? []) {
    coverByProduct.set(row.product_id, row);
  }

  return products.map((p) => ({ ...p, cover: coverByProduct.get(p.id) ?? null }));
}

export async function countByStatus(
  db: D1Database,
  opts: { publicOnly?: boolean } = {},
): Promise<Record<ProductStatus, number>> {
  const where = opts.publicOnly
    ? `WHERE status IN (${PUBLIC_STATUSES.map(() => "?").join(",")})`
    : "";
  const binds = opts.publicOnly ? [...PUBLIC_STATUSES] : [];
  const sql = `SELECT status, COUNT(*) AS n FROM products ${where} GROUP BY status`;
  const res = await db
    .prepare(sql)
    .bind(...binds)
    .all<{ status: string; n: number }>();
  const out: Record<ProductStatus, number> = {
    draft: 0,
    private: 0,
    on_sale: 0,
    reserved: 0,
    sold: 0,
  };
  for (const r of res.results ?? []) {
    if (isProductStatus(r.status)) out[r.status] = r.n;
  }
  return out;
}

export async function getProductById(
  db: D1Database,
  id: number,
): Promise<ProductWithImages | null> {
  const productRow = await db
    .prepare(`${SELECT_PRODUCT} WHERE id = ?`)
    .bind(id)
    .first<ProductRow>();
  if (!productRow) return null;

  const imgRes = await db
    .prepare(`${SELECT_IMAGE} WHERE product_id = ? ORDER BY position ASC`)
    .bind(id)
    .all<ImageRow>();
  const images: ProductImage[] = (imgRes.results ?? []).map((r) => ({ ...r }));

  return { ...rowToProduct(productRow), images };
}

export interface ProductInput {
  title: string;
  description: string;
  price: number;
  brand: string;
  category: string;
  status: ProductStatus;
}

export async function createProduct(db: D1Database, input: ProductInput): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const publishedAt = isPublic(input.status) ? now : null;

  const res = await db
    .prepare(
      `INSERT INTO products (title, description, price, brand, category, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(
      input.title,
      input.description,
      input.price,
      input.brand,
      input.category,
      input.status,
      publishedAt,
      now,
      now,
    )
    .first<{ id: number }>();

  if (!res) throw new Error("INSERT did not return an id");
  return res.id;
}

export async function updateProduct(
  db: D1Database,
  id: number,
  input: ProductInput,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE products
       SET title = ?, description = ?, price = ?, brand = ?, category = ?, status = ?,
           published_at = COALESCE(published_at, CASE WHEN ? THEN ? ELSE NULL END),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.title,
      input.description,
      input.price,
      input.brand,
      input.category,
      input.status,
      isPublic(input.status) ? 1 : 0,
      now,
      now,
      id,
    )
    .run();
}

export async function updateStatus(
  db: D1Database,
  id: number,
  status: ProductStatus,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE products
       SET status = ?,
           published_at = COALESCE(published_at, CASE WHEN ? THEN ? ELSE NULL END),
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(status, isPublic(status) ? 1 : 0, now, now, id)
    .run();
}

/**
 * Returns the R2 keys of every image attached to the product so the caller
 * can clean them up from R2 after the row is deleted.
 */
export async function deleteProduct(db: D1Database, id: number): Promise<string[]> {
  const imgs = await db
    .prepare("SELECT r2_key FROM product_images WHERE product_id = ?")
    .bind(id)
    .all<{ r2_key: string }>();
  await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
  return (imgs.results ?? []).map((r) => r.r2_key);
}

export async function nextImagePosition(db: D1Database, productId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(MAX(position), -1) AS m FROM product_images WHERE product_id = ?")
    .bind(productId)
    .first<{ m: number }>();
  return (row?.m ?? -1) + 1;
}

export async function attachImage(
  db: D1Database,
  args: { productId: number; r2Key: string; position: number; width?: number; height?: number },
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO product_images (product_id, r2_key, position, width, height)
       VALUES (?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(args.productId, args.r2Key, args.position, args.width ?? null, args.height ?? null)
    .first<{ id: number }>();
  if (!res) throw new Error("Image INSERT did not return an id");
  return res.id;
}

/**
 * Detach a single image by id; returns its R2 key for downstream deletion.
 */
export async function detachImage(
  db: D1Database,
  args: { productId: number; imageId: number },
): Promise<string | null> {
  const row = await db
    .prepare("SELECT r2_key FROM product_images WHERE id = ? AND product_id = ?")
    .bind(args.imageId, args.productId)
    .first<{ r2_key: string }>();
  if (!row) return null;
  await db
    .prepare("DELETE FROM product_images WHERE id = ? AND product_id = ?")
    .bind(args.imageId, args.productId)
    .run();
  return row.r2_key;
}

function isPublic(status: ProductStatus): boolean {
  return status === "on_sale" || status === "reserved" || status === "sold";
}
