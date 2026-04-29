import type { APIRoute } from "astro";
import { deleteImages } from "../../../../../../lib/images";
import { detachImage } from "../../../../../../lib/products";

export const POST: APIRoute = async ({ params, request, locals }) => {
  const productId = Number(params.id ?? "");
  const imageId = Number(params.imageId ?? "");
  if (!Number.isInteger(productId) || productId <= 0) {
    return new Response("Bad Request", { status: 400 });
  }
  if (!Number.isInteger(imageId) || imageId <= 0) {
    return new Response("Bad Request", { status: 400 });
  }

  const env = locals.runtime.env;
  const r2Key = await detachImage(env.DB, { productId, imageId });
  if (!r2Key) {
    return new Response("Not Found", { status: 404 });
  }
  await deleteImages(env.IMAGES, [r2Key]);

  return Response.redirect(
    new URL(
      `/admin/items/${productId}/edit?flash=${encodeURIComponent("写真を削除しました。")}`,
      request.url,
    ),
    303,
  );
};
