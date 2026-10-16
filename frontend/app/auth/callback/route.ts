import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  if (error) {
    console.error("OAuth error received in callback:", error, errorDescription);
    const sanitizedError = encodeURIComponent(errorDescription || error);
    return NextResponse.redirect(`${origin}${next}?auth_error=${sanitizedError}`);
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (!exchangeError) {
        const forwardedHost = request.headers.get("x-forwarded-host");
        const isLocalhost = origin.includes("localhost") || origin.includes("127.0.0.1");

        if (forwardedHost && !isLocalhost) {
          return NextResponse.redirect(`https://${forwardedHost}${next}`);
        }
        return NextResponse.redirect(`${origin}${next}`);
      }
      console.error("Supabase OAuth code exchange error:", exchangeError.message);
      return NextResponse.redirect(
        `${origin}${next}?auth_error=${encodeURIComponent(exchangeError.message)}`
      );
    } catch (err) {
      console.error("Exception during auth exchange:", err);
      return NextResponse.redirect(
        `${origin}${next}?auth_error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`
      );
    }
  }

  return NextResponse.redirect(`${origin}${next}`);
}