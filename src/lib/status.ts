/**
 * Product status definitions and mapping helpers.
 *
 * D1 stores the canonical status values (`draft / private / on_sale /
 * reserved / sold`). The design surfaces a slightly different vocabulary
 * (`available / hidden / ...`). Map between them in one place.
 */

export const PRODUCT_STATUSES = ["draft", "private", "on_sale", "reserved", "sold"] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PUBLIC_STATUSES = ["on_sale", "reserved", "sold"] as const;
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];

const LABEL: Record<ProductStatus, string> = {
  on_sale: "販売中",
  reserved: "予約済み",
  sold: "売却済み",
  draft: "下書き",
  private: "非公開",
};

const TONE: Record<ProductStatus, "success" | "warning" | "muted" | "soft" | "private"> = {
  on_sale: "success",
  reserved: "warning",
  sold: "muted",
  draft: "soft",
  private: "private",
};

export function statusLabel(status: ProductStatus): string {
  return LABEL[status];
}

export function statusTone(status: ProductStatus): (typeof TONE)[ProductStatus] {
  return TONE[status];
}

export function isProductStatus(value: unknown): value is ProductStatus {
  return typeof value === "string" && (PRODUCT_STATUSES as readonly string[]).includes(value);
}

export function isPublicStatus(value: ProductStatus): value is PublicStatus {
  return (PUBLIC_STATUSES as readonly string[]).includes(value);
}
