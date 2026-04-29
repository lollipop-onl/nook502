import type { APIRoute } from "astro";
import { PUBLIC_STATUSES } from "../../lib/status";

/**
 * Streams an image stored in R2 under `images/...`.
 *
 * Visibility: an image is only served when its parent product has a
 * publicly-visible status (`on_sale | reserved | sold`). Drafts and
 * private items 404 here even if the R2 key leaks.
 *
 * Caching: long-lived immutable cache headers — R2 keys include a UUID,
 * so they're safe to treat as immutable. `If-None-Match` against `etag`
 * keeps repeat hits cheap.
 *
 * In production we expect to flip this to an R2 public custom domain so
 * the worker doesn't sit in front of every image. Until then, this
 * endpoint keeps URLs stable (`/images/{productId}/{uuid}.{ext}`).
 */
export const GET: APIRoute = async ({ params, request, locals }) => {
  const rest = (params.key ?? "") as string | string[];
  const tail = Array.isArray(rest) ? rest.join("/") : rest;
  if (!tail) {
    return new Response("Not Found", { status: 404 });
  }

  const env = locals.runtime.env;
  const key = `images/${tail}`;

  // Visibility gate: look up the parent product status. The `r2_key`
  // column is UNIQUE so this returns at most one row.
  const visibility = await env.DB.prepare(
    `SELECT p.status AS status
     FROM product_images pi
     JOIN products p ON p.id = pi.product_id
     WHERE pi.r2_key = ?
     LIMIT 1`,
  )
    .bind(key)
    .first<{ status: string }>();

  if (!visibility || !(PUBLIC_STATUSES as readonly string[]).includes(visibility.status)) {
    return new Response("Not Found", { status: 404 });
  }

  // Fast path — head check returns 304 without streaming the body.
  // R2's `httpEtag` is already a quoted entity tag, pass it through verbatim.
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch) {
    const head = await env.IMAGES.head(key);
    if (head && head.httpEtag === ifNoneMatch) {
      return new Response(null, {
        status: 304,
        headers: { etag: head.httpEtag },
      });
    }
  }

  const obj = await env.IMAGES.get(key);
  if (!obj) {
    return new Response("Not Found", { status: 404 });
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }
  headers.set("etag", obj.httpEtag);

  return new Response(obj.body, { headers });
};
