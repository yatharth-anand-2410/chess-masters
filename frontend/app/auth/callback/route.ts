import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { resolveCallbackBase } from "../../../lib/callback-url";
import { SITE_URL } from "../../../lib/site";

/**
 * Parse the incoming Cookie header into name/value pairs.
 *
 * The callback runs in a Route Handler and returns its own redirect response, so
 * it attaches the session cookies to that response explicitly instead of
 * relying on `cookies()` mutations being merged into a response we built by
 * hand. If the session cookie did not reach the browser, sign-in would appear to
 * succeed and the player would land back on a signed-out page.
 */
function parseCookies(header: string | null): { name: string; value: string }[] {
  if (!header) {
    return [];
  }
  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index === -1) {
        return { name: part, value: "" };
      }
      return { name: part.slice(0, index), value: part.slice(index + 1) };
    });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Never build this from request.url alone: behind the load balancer that is
  // the container's own bind address (0.0.0.0:8080), which the browser cannot
  // reach. See lib/callback-url.ts.
  const base = resolveCallbackBase(request, SITE_URL);

  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.error("OAuth error received in callback:", error, errorDescription);
    const sanitizedError = encodeURIComponent(errorDescription || error);
    return NextResponse.redirect(`${base}${next}?auth_error=${sanitizedError}`);
  }

  if (!code) {
    return NextResponse.redirect(`${base}${next}`);
  }

  const response = NextResponse.redirect(`${base}${next}`);
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return parseCookies(request.headers.get("cookie"));
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  try {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (!exchangeError) {
      return response;
    }
    console.error("Supabase OAuth code exchange error:", exchangeError.message);
    return NextResponse.redirect(
      `${base}${next}?auth_error=${encodeURIComponent(exchangeError.message)}`
    );
  } catch (err) {
    console.error("Exception during auth exchange:", err);
    return NextResponse.redirect(
      `${base}${next}?auth_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`
    );
  }
}
