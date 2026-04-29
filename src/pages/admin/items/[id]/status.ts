import type { APIRoute } from "astro";
import { getProductById, updateStatus } from "../../../../lib/products";
import { isProductStatus } from "../../../../lib/status";

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = Number(params.id ?? "");
  if (!Number.isInteger(id) || id <= 0) {
    return new Response("Bad Request", { status: 400 });
  }

  const form = await request.formData();
  const status = (form.get("status") ?? "").toString();
  if (!isProductStatus(status)) {
    return new Response("Invalid status", { status: 400 });
  }

  const db = locals.runtime.env.DB;
  const product = await getProductById(db, id);
  if (!product) {
    return new Response("Not Found", { status: 404 });
  }

  await updateStatus(db, id, status);

  return Response.redirect(
    new URL(
      `/admin?flash=${encodeURIComponent(`「${product.title}」のステータスを更新しました。`)}`,
      request.url,
    ),
    303,
  );
};
