/**
 * Product form validation. Returns either a typed `ProductInput` or a map
 * of field-level error messages.
 */
import type { ProductInput } from "./products";
import type { ProductStatus } from "./status";
import { isProductStatus } from "./status";

type FieldErrors = Partial<Record<keyof ProductInput, string>>;

interface ValidateOk {
  ok: true;
  value: ProductInput;
}

interface ValidateErr {
  ok: false;
  errors: FieldErrors;
  /** What we managed to coerce — used to re-render the form with the user's input. */
  partial: Partial<ProductInput>;
}

const TITLE_MAX = 120;
const BRAND_MAX = 80;
const DESC_MAX = 2000;
const CATEGORY_MAX = 40;
const PRICE_MAX = 9_999_999;

export function parseProductForm(form: FormData): ValidateOk | ValidateErr {
  const errors: FieldErrors = {};
  const title = (form.get("title") ?? "").toString().trim();
  const brand = (form.get("brand") ?? "").toString().trim();
  const category = (form.get("category") ?? "").toString().trim();
  const description = (form.get("description") ?? "").toString().trim();
  const priceRaw = (form.get("price") ?? "").toString().trim();
  const statusRaw = (form.get("status") ?? "").toString().trim();

  if (!title) errors.title = "タイトルを入力してください。";
  else if (title.length > TITLE_MAX)
    errors.title = `タイトルは ${TITLE_MAX} 文字以内で入力してください。`;

  if (!brand) errors.brand = "ブランド／販売店を入力してください。";
  else if (brand.length > BRAND_MAX)
    errors.brand = `ブランドは ${BRAND_MAX} 文字以内で入力してください。`;

  if (!category) errors.category = "カテゴリーを選択してください。";
  else if (category.length > CATEGORY_MAX) errors.category = "カテゴリーが長すぎます。";

  if (!description) errors.description = "説明を入力してください。";
  else if (description.length > DESC_MAX)
    errors.description = `説明は ${DESC_MAX} 文字以内で入力してください。`;

  let price = NaN;
  if (!priceRaw) {
    errors.price = "値段を入力してください。";
  } else {
    price = Number(priceRaw);
    if (!Number.isFinite(price) || !Number.isInteger(price) || price < 0) {
      errors.price = "値段は0以上の整数で入力してください。";
    } else if (price > PRICE_MAX) {
      errors.price = "値段が大きすぎます。";
    }
  }

  let status: ProductStatus = "draft";
  if (statusRaw && isProductStatus(statusRaw)) {
    status = statusRaw;
  } else if (statusRaw) {
    errors.status = "公開ステータスが不正です。";
  }

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      errors,
      partial: {
        title,
        brand,
        category,
        description,
        price: Number.isFinite(price) ? price : undefined,
        status,
      },
    };
  }

  return {
    ok: true,
    value: { title, description, price, brand, category, status },
  };
}
