import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { updateProspect } from "@/lib/prospection-db";

const SYSTEM_PROMPT = `Tu es le commercial de TUTTO LEGNO, une menuiserie bois massif haut de gamme basée à Cocody Abatta, Abidjan.
Tu rédiges des messages WhatsApp courts, professionnels et personnalisés pour prospecter des clients potentiels.
Ton ton est confiant, respectueux et direct.
Tu ne fais jamais plus de 5 lignes.
Tu mentionnes toujours un élément spécifique au secteur du prospect.
Tu écris en français ivoirien professionnel, sans emojis excessifs.`;

function nettoyerNumero(tel: string): string {
  let chiffres = tel.replace(/\D/g, "");
  if (chiffres.startsWith("00")) chiffres = chiffres.slice(2);
  if (chiffres.startsWith("225") && chiffres.length === 13) return chiffres;
  if (chiffres.startsWith("0") && chiffres.length === 10) return "225" + chiffres.slice(1);
  if (chiffres.length === 10) return "225" + chiffres;
  if (chiffres.length === 8) return "225" + chiffres;
  return "";
}

function genererLienWhatsApp(tel: string, message: string): string {
  const numero = nettoyerNumero(tel);
  if (!numero) return "";
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      console.error("[prospection/generate] GROQ_API_KEY not set");
      return NextResponse.json({ error: "Erreur serveur. GROQ_API_KEY non configurée" }, { status: 500 });
    }
    const { prospect_id, nom_entreprise, secteur, telephone } = await req.json();

    if (!nom_entreprise || !prospect_id) {
      return NextResponse.json({ error: "prospect_id et nom_entreprise requis" }, { status: 400 });
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const userPrompt = `Rédige un message WhatsApp de prospection pour ${nom_entreprise}, une entreprise du secteur ${secteur || "Immobilier"} basée à Abidjan.
Propose les services de TUTTO LEGNO : portes sur mesure, cuisines européennes, dressings et meubles TV en bois massif.
Termine par notre contact : 07 07 55 35 45 et notre site : www.tutto-legno.ci`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const message = completion.choices[0].message.content?.trim() || "";
    const lien    = telephone ? genererLienWhatsApp(telephone, message) : "";

    // Sauvegarder directement en base
    updateProspect(prospect_id, {
      message_genere: message,
      lien_whatsapp:  lien || null,
    });

    return NextResponse.json({ message, lien });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
