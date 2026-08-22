import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Ne pas exécuter Supabase pour les API
  if (path.startsWith("/api")) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          supabaseResponse = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  let user: any = null;
  try {
    const fetchUser = supabase.auth.getUser();

    // Prevent middleware from waiting too long for Supabase (avoid 504s).
    // If Supabase doesn't respond within 800ms, allow the request through
    // to avoid blocking the edge middleware.
    const res = (await Promise.race([
      fetchUser,
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 800)),
    ])) as any;

    if (res && res.timeout) {
      return supabaseResponse;
    }

    user = res?.data?.user ?? null;
  } catch (e) {
    // On error, don't block the request from proceeding.
    return supabaseResponse;
  }

  const isLogin = path.startsWith("/login");

  if (!user && !isLogin) {
    return NextResponse.redirect(
      new URL("/login", request.url)
    );
  }

  if (user && isLogin) {
    return NextResponse.redirect(
      new URL("/", request.url)
    );
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)",
  ],
};