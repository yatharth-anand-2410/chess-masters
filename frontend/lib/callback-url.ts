/**
 * Where to send the browser after the OAuth code exchange.
 *
 * The app runs in a container behind Google's load balancer. Inside the
 * container the request's own Host header is the bind address
 * (`0.0.0.0:8080`) and the load balancer does not forward `x-forwarded-host`,
 * so a redirect built from `request.url` used to send the browser to an address
 * nothing can reach: sign-in ended on `ERR_CONNECTION_REFUSED` after Google
 * had already authenticated the player.
 *
 * Order of preference:
 *   1. a localhost origin, so development keeps working;
 *   2. a real forwarded host (Vercel, a corporate proxy, a direct run.app hit);
 *   3. the canonical site URL, which is correct for production traffic.
 */

type RequestLike = {
  url: string;
  headers: { get(name: string): string | null };
};

/** Hosts that describe the container, not the visitor. */
function isInternalHost(host: string): boolean {
  return (
    host.startsWith("0.0.0.0") ||
    host.startsWith("localhost") ||
    host.startsWith("127.") ||
    host.endsWith(":8080")
  );
}

export function resolveCallbackBase(request: RequestLike, siteUrl: string): string {
  const { origin } = new URL(request.url);
  if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
    return origin;
  }

  const candidate =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (candidate && !isInternalHost(candidate)) {
    return `https://${candidate.replace(/^https?:\/\//, "")}`;
  }

  return siteUrl;
}
