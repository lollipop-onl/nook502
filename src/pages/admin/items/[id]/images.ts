import type { APIRoute } from "astro";
import { ImageError, uploadProductImage } from "../../../../lib/images";
import { attachImage, getProductById, nextImagePosition } from "../../../../lib/products";

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id ?? "");
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("Bad Request", { status: 400 });
  }

  const env = locals.runtime.env;
  const product = await getProductById(env.DB, id);
  if (!product) {
    return new Response("Not Found", { status: 404 });
  }

  // Workers requests are one-shot: read formData once and don't re-touch
  // `request` after this point.
  const form = await request.formData();
  const file = form.get("image");

  if (!(file instanceof File)) {
    return redirectWithImageError(request, id, "ファイルが見つかりません。");
  }

  let r2Key: string;
  try {
    const upload = await uploadProductImage(env.IMAGES, { productId: id, file });
    r2Key = upload.r2Key;
  } catch (err) {
    if (err instanceof ImageError) {
      return redirectWithImageError(request, id, err.message);
    }
    throw err;
  }

  // Insert the DB row after the R2 put. If D1 fails (e.g. a concurrent
  // upload races on the (product_id, position) UNIQUE constraint) we roll
  // back the R2 object so we don't leak orphans. Workers don't have a
  // real distributed transaction, so this is the best we can do without
  // pulling in a coordination primitive.
  try {
    const position = await nextImagePosition(env.DB, id);
    await attachImage(env.DB, { productId: id, r2Key, position });
  } catch (err) {
    await env.IMAGES.delete(r2Key).catch(() => {});
    throw err;
  }

  return Response.redirect(
    new URL(
      `/admin/items/${id}/edit?flash=${encodeURIComponent("写真を追加しました。")}`,
      request.url,
    ),
    303,
  );
};

function redirectWithImageError(request: Request, id: number, message: string): Response {
  const url = new URL(
    `/admin/items/${id}/edit?image_error=${encodeURIComponent(message)}`,
    request.url,
  );
  return Response.redirect(url, 303);
}
