import type { APIRoute } from "astro";

/**
 * Admin-only image stream. The `/admin/*` middleware already verifies CF
 * Access, so this handler can serve any R2 object regardless of product
 * status (drafts and private items must still preview in the admin UI).
 */
export const GET: APIRoute = async ({ params, request, locals }) => {
  const rest = (params.key ?? "") as string | string[];
  const tail = Array.isArray(rest) ? rest.join("/") : rest;
  if (!tail) return new Response("Not Found", { status: 404 });

  const key = `images/${tail}`;
  const env = locals.runtime.env;

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch) {
    const head = await env.IMAGES.head(key);
    if (head && head.httpEtag === ifNoneMatch) {
      return new Response(null, { status: 304, headers: { etag: head.httpEtag } });
    }
  }

  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has("cache-control")) {
    // Admin views shouldn't sit in shared caches.
    headers.set("cache-control", "private, max-age=300");
  }
  headers.set("etag", obj.httpEtag);

  return new Response(obj.body, { headers });
};
