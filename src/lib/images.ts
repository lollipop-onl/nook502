/**
 * R2-side helpers for product images.
 *
 * - Storage layout: `images/{productId}/{uuid}.{ext}` so a delete-all-by-prefix
 *   for a product is trivial if we ever need it.
 * - Validation is small but firm: only image/* with a known ext, max 5 MB.
 *   We reject up front rather than trusting the client's content-type.
 */

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXT_BY_TYPE: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export function isAllowedImageType(value: string): value is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(value);
}

export function buildImageKey(productId: number, contentType: AllowedImageType): string {
  const ext = EXT_BY_TYPE[contentType];
  const uuid = crypto.randomUUID();
  return `images/${productId}/${uuid}.${ext}`;
}

export interface UploadOptions {
  productId: number;
  file: File;
}

export interface UploadResult {
  r2Key: string;
  contentType: AllowedImageType;
  size: number;
}

/**
 * Validate then put the file into R2. Caller is responsible for inserting
 * the corresponding `product_images` row (so DB and R2 commits stay paired
 * in one place).
 */
export async function uploadProductImage(
  bucket: R2Bucket,
  opts: UploadOptions,
): Promise<UploadResult> {
  const { file, productId } = opts;
  if (!file || file.size === 0) {
    throw new ImageError("FILE_REQUIRED", "ファイルが選択されていません。");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ImageError("FILE_TOO_LARGE", "画像は 5MB までです。");
  }
  if (!isAllowedImageType(file.type)) {
    throw new ImageError("UNSUPPORTED_TYPE", "JPEG / PNG / WebP / AVIF のみアップロードできます。");
  }

  const key = buildImageKey(productId, file.type);
  // `arrayBuffer()` consumes the body once; do not re-read `file`.
  const body = await file.arrayBuffer();
  await bucket.put(key, body, {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable",
    },
  });

  return { r2Key: key, contentType: file.type, size: file.size };
}

export async function deleteImages(bucket: R2Bucket, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  // R2 supports batch delete via `delete([...keys])` (overload).
  await bucket.delete(keys);
}

export class ImageError extends Error {
  readonly code: "FILE_REQUIRED" | "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE";

  constructor(code: ImageError["code"], message: string) {
    super(message);
    this.code = code;
    this.name = "ImageError";
  }
}

/**
 * Public URL for a stored image. The `/images/...` endpoint enforces a
 * visibility gate (only serves images for products in a public status).
 * Switching to an R2 public custom domain later means changing this one
 * function.
 */
export function imageUrl(r2Key: string): string {
  return `/${r2Key}`;
}

/**
 * Admin-only URL — routes through `/admin/images/...` which is protected
 * by Cloudflare Access middleware and serves any image regardless of
 * product status (so drafts/private items still preview correctly).
 */
export function imageAdminUrl(r2Key: string): string {
  return `/admin/${r2Key}`;
}
