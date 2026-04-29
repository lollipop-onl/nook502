import type { APIRoute } from "astro";
import { deleteImages } from "../../../../lib/images";
import { deleteProduct, getProductById } from "../../../../lib/products";

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

  // Drop the row first; cascade also removes product_images. Then clean up R2.
  // If R2 deletes fail we're left with orphaned objects rather than a broken
  // DB — easier to reconcile later than the inverse.
  const r2Keys = await deleteProduct(env.DB, id);
  await deleteImages(env.IMAGES, r2Keys);

  return Response.redirect(
    new URL(
      `/admin?flash=${encodeURIComponent(`「${product.title}」を削除しました。`)}`,
      request.url,
    ),
    303,
  );
};
