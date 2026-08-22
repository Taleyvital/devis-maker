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

// GET — messages + devis_data de la session
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = serverSupabase();
  const [messagesRes, sessionRes] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", params.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("chat_sessions")
      .select("devis_data")
      .eq("id", params.id)
      .single(),
  ]);

  if (messagesRes.error) return NextResponse.json({ error: messagesRes.error.message }, { status: 500 });

  return NextResponse.json({
    messages:   messagesRes.data,
    devis_data: sessionRes.data?.devis_data ?? null,
  });
}

// POST — ajouter des messages + mettre à jour devis_data
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = serverSupabase();
  const { messages, devis_data } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "Messages invalides" }, { status: 400 });
  }

  const rows = messages.map((m: { role: string; content: string }) => ({
    session_id: params.id,
    role:       m.role,
    content:    m.content,
  }));

  const [insertRes] = await Promise.all([
    supabase.from("chat_messages").insert(rows),
    supabase
      .from("chat_sessions")
      .update({
        updated_at: new Date().toISOString(),
        ...(devis_data ? { devis_data } : {}),
      })
      .eq("id", params.id),
  ]);

  if (insertRes.error) return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
