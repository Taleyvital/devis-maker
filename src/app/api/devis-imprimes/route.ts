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

export async function POST(req: NextRequest) {
  const supabase = serverSupabase();
  const devis = await req.json();
  const totalMat = (devis.lignes ?? []).reduce(
    (acc: number, l: { montant?: string | number }) => acc + (parseFloat(String(l.montant)) || 0),
    0
  );
  const mo    = parseFloat(String(devis.main_oeuvre)) || 0;
  const total = totalMat + mo;

  const { error } = await supabase.from("devis_imprimes").insert({
    client_nom:     devis.client_nom     || "",
    client_contact: devis.client_contact || "",
    client_objet:   devis.client_objet   || "",
    titre_travaux:  devis.titre_travaux  || "",
    total,
    main_oeuvre:    mo,
    data:           devis,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const supabase = serverSupabase();

  const { data, error } = await supabase
    .from("devis_imprimes")
    .select("id, client_nom, client_objet, titre_travaux, total, imprime_a")
    .order("imprime_a", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
