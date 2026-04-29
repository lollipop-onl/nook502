/**
 * Astro middleware.
 *
 * Two responsibilities:
 *   1. Protect `/admin/*` with Cloudflare Access JWT (defense in depth).
 *   2. CSRF defense: reject mutating requests whose `Origin`/`Referer`
 *      don't match the request host. CF Access guards reading admin pages,
 *      but the `CF_Authorization` cookie travels on cross-site POSTs too,
 *      so without a same-origin check a forged form on another site could
 *      drive the API.
 */
import { defineMiddleware } from "astro:middleware";
import { type AccessIdentity, verifyAccess } from "./lib/access";

declare global {
  namespace App {
    interface Locals {
      access?: AccessIdentity;
    }
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const onRequest = defineMiddleware(async (context, next) => {
  const { request } = context;
  const url = new URL(request.url);

  // CSRF: same-origin enforcement on mutating methods.
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request, url)) {
    return new Response("CSRF: cross-origin request rejected", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Admin gate.
  if (url.pathname.startsWith("/admin")) {
    const env = (context.locals.runtime?.env ?? {}) as Record<string, unknown>;
    const identity = await verifyAccess(request, env);
    if (!identity) {
      return new Response("Forbidden — Cloudflare Access required", {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    context.locals.access = identity;
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
