/**
 * Cloudflare Access JWT verification.
 *
 * Cloudflare injects the `Cf-Access-Jwt-Assertion` header (and a matching
 * cookie) into every request that has cleared Access. We re-verify the
 * signature in the worker to defend against header spoofing if someone
 * mis-configures the application or bypasses Access.
 *
 * Design decisions:
 * - JWKS is fetched lazily and cached in module scope, keyed by `kid`.
 *   On an unknown `kid` we always refetch (single in-flight promise shared
 *   across concurrent verifications) — Cloudflare rotates keys every ~6
 *   weeks with a 7-day overlap, so caching forever is wrong.
 * - Local dev bypass requires *explicit opt-in* (`CF_ACCESS_DEV_BYPASS=1`).
 *   Missing config in production is treated as fail-closed: every request
 *   is denied. This is a deliberate choice — fail-open here would expose
 *   `/admin/*` on a single misconfigured deploy.
 *
 * Refs:
 *   https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
 */

export interface AccessIdentity {
  email: string;
  sub: string;
  /** When true, the request bypassed real verification (dev mode). */
  dev: boolean;
}

interface JwksKey {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

interface Jwks {
  keys: JwksKey[];
}

interface AccessConfig {
  teamDomain: string;
  audience: string;
}

interface ResolvedAccess {
  mode: "verify" | "dev-bypass" | "deny";
  config?: AccessConfig;
}

function resolveAccess(env: Record<string, unknown>): ResolvedAccess {
  const team = typeof env.CF_ACCESS_TEAM_DOMAIN === "string" ? env.CF_ACCESS_TEAM_DOMAIN : "";
  const aud = typeof env.CF_ACCESS_AUD === "string" ? env.CF_ACCESS_AUD : "";

  if (team && aud) {
    return { mode: "verify", config: { teamDomain: team, audience: aud } };
  }

  // Explicit dev bypass — must be set on purpose. Treat any other "missing
  // config" state as fail-closed so a prod misconfig doesn't open admin.
  if (env.CF_ACCESS_DEV_BYPASS === "1" || env.CF_ACCESS_DEV_BYPASS === "true") {
    return { mode: "dev-bypass" };
  }

  return { mode: "deny" };
}

const keyCache = new Map<string, CryptoKey>();
let inflightFetch: Promise<void> | null = null;
let lastJwksFetchAt = 0;
const JWKS_REFETCH_DEBOUNCE_MS = 5_000;

async function refreshJwks(teamDomain: string): Promise<void> {
  // De-duplicate concurrent refreshes — many requests may simultaneously
  // see an unknown kid right after rotation.
  if (inflightFetch) return inflightFetch;

  // Debounce against tight loops (e.g. mass forged-kid attempts).
  if (Date.now() - lastJwksFetchAt < JWKS_REFETCH_DEBOUNCE_MS) return;

  inflightFetch = (async () => {
    try {
      const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
        cf: { cacheTtl: 300 } as RequestInitCfProperties,
      });
      if (!res.ok) throw new Error(`Access JWKS fetch failed: ${res.status}`);
      const jwks = (await res.json()) as Jwks;
      const next = new Map<string, CryptoKey>();
      for (const key of jwks.keys) {
        if (key.kty !== "RSA" || !key.kid) continue;
        const cryptoKey = await crypto.subtle.importKey(
          "jwk",
          { kty: key.kty, n: key.n, e: key.e, alg: key.alg ?? "RS256", ext: true },
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        );
        next.set(key.kid, cryptoKey);
      }
      // Replace atomically rather than merge — old keys removed by
      // Cloudflare must drop out, even if they were cached locally.
      keyCache.clear();
      for (const [k, v] of next) keyCache.set(k, v);
      lastJwksFetchAt = Date.now();
    } finally {
      inflightFetch = null;
    }
  })();

  return inflightFetch;
}

async function loadKey(teamDomain: string, kid: string): Promise<CryptoKey | null> {
  const cached = keyCache.get(kid);
  if (cached) return cached;
  await refreshJwks(teamDomain);
  return keyCache.get(kid) ?? null;
}

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  const bin = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface JwtPayload {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  iat?: number;
  email?: string;
  sub?: string;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

async function verifyJwt(token: string, cfg: AccessConfig): Promise<AccessIdentity | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(headerB64)));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadB64)));
  } catch {
    return null;
  }

  if (header.alg !== "RS256" || !header.kid) return null;

  const key = await loadKey(cfg.teamDomain, header.kid);
  if (!key) return null;

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlToBytes(signatureB64);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now - 5) return null;

  const expectedIss = `https://${cfg.teamDomain}`;
  if (payload.iss && payload.iss !== expectedIss) return null;

  const audClaim = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (!audClaim.includes(cfg.audience)) return null;

  return {
    email: payload.email ?? "unknown@cloudflareaccess",
    sub: payload.sub ?? "",
    dev: false,
  };
}

/**
 * Verify the request against Cloudflare Access. Returns the identity on
 * success, or null when the request must be rejected.
 *
 * - With `CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`: real JWT verification.
 * - With `CF_ACCESS_DEV_BYPASS=1`: synthetic dev identity (local only).
 * - Otherwise: deny — admin must not become reachable through misconfig.
 */
export async function verifyAccess(
  request: Request,
  env: Record<string, unknown>,
): Promise<AccessIdentity | null> {
  const resolved = resolveAccess(env);

  if (resolved.mode === "dev-bypass") {
    return { email: "dev@local", sub: "dev", dev: true };
  }
  if (resolved.mode === "deny" || !resolved.config) {
    console.warn(
      "[access] CF Access env not configured (CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD missing). Denying request.",
    );
    return null;
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion") ?? extractCookieToken(request);
  if (!token) return null;
  return verifyJwt(token, resolved.config);
}

function extractCookieToken(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(/;\s*/)) {
    const [name, ...rest] = part.split("=");
    if (name === "CF_Authorization") return rest.join("=");
  }
  return null;
}
