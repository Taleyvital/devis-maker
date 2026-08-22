import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function serverSupabase() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cs) { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); },
      },
    }
  );
}

// GET — liste des sessions
export async function GET() {
  const supabase = serverSupabase();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("id, titre, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — créer une session
export async function POST(req: NextRequest) {
  const supabase = serverSupabase();
  const { titre } = await req.json().catch(() => ({ titre: "Nouvelle discussion" }));

  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({ titre: titre || "Nouvelle discussion" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
