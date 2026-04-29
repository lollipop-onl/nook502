/**
 * Astro middleware.
 *
 * CSRF defense: reject mutating requests whose `Origin`/`Referer` don't
 * match the request host. `/admin/*` の認可は Cloudflare Access が前段で
 * 行うため、Worker 側では JWT 再検証はしない。
 */
import { defineMiddleware } from "astro:middleware";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);

  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request, url)) {
    return new Response("CSRF: cross-origin request rejected", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return next();
});

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === url.host;
    } catch {
      return false;
    }
  }
  // Some browsers omit `Origin` on top-level form POSTs to same-origin
  // targets but always send `Referer`. Fall back to that.
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === url.host;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer on a mutating request — treat as suspect.
  return false;
}
