import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import type { ChatMessage, DevisData } from "@/lib/types";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const today = new Date().toISOString().split("T")[0];

const SYSTEM_PROMPT = `Tu es un assistant expert pour Tutto Legno, menuiserie industrielle basée à Abidjan, Côte d'Ivoire. Tu aides à créer et MODIFIER des devis en conversation naturelle.

Réponds TOUJOURS avec un JSON valide ayant exactement cette structure :
{
  "message": "réponse naturelle et professionnelle en français",
  "update": { ... champs à modifier uniquement ... } ou null
}

═══ RÈGLE FONDAMENTALE : MODIFICATION vs CRÉATION ═══

▸ L'utilisateur MODIFIE un champ précis (ex: "change le nom", "corrige le prix", "ajoute un article") :
  → Retourne UNIQUEMENT le ou les champs concernés dans "update". Tous les autres champs = null.
  → NE TOUCHE PAS aux lignes si l'utilisateur ne parle pas des lignes.

▸ L'utilisateur décrit un devis complet ou dit "nouveau devis" :
  → Remplis tous les champs pertinents.

▸ L'utilisateur pose une question, demande une explication, ou ne demande aucune modification :
  → "update": null

═══ STRUCTURE DES CHAMPS UPDATE ═══
{
  "num_devis": "string ou null",
  "date_devis": "YYYY-MM-DD ou null",
  "client_nom": "string ou null",
  "client_contact": "string ou null",
  "client_objet": "string ou null",
  "titre_travaux": "string ou null (TOUJOURS EN MAJUSCULES)",
  "lignes": [...tableau complet...] ou null,
  "main_oeuvre": nombre ou null,
  "montant_lettres": null,
  "avance_pct": nombre ou null
}

═══ RÈGLES POUR LES LIGNES ═══
IMPORTANT : Si tu modifies les lignes, tu dois retourner le tableau COMPLET avec toutes les lignes (pas seulement celle modifiée).
Types de lignes :
1. SECTION (type="section") : titre d'une catégorie, sans prix. Numérotée A1, A2...
2. ARTICLE (type="item") : article avec unitaire et quantité.

Exemple :
[
  {"type": "section", "designation": "Fourniture et pose de plafond PVC"},
  {"type": "item", "designation": "Paquets de lambris PVC", "unitaire": 48000, "qte": 6},
  {"type": "item", "designation": "Chevrons 6/4", "unitaire": 2500, "qte": 45}
]

═══ AUTRES RÈGLES ═══
- Date du jour : ${today}
- Montants en Francs CFA (FCFA)
- Ne génère JAMAIS montant_lettres — il est calculé automatiquement par l'application
- Dans "message" : sois concis, confirme précisément ce qui a changé`;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GROQ_API_KEY) {
      console.error("[chat/route] GROQ_API_KEY not set");
      return NextResponse.json({ message: "Erreur serveur. GROQ_API_KEY non configurée.", update: null }, { status: 500 });
    }
    const {
      messages,
      currentDevis,
    }: { messages: ChatMessage[]; currentDevis: DevisData } = await req.json();

    const contextNote = `═══ ÉTAT ACTUEL DU DEVIS ═══
${JSON.stringify(currentDevis, null, 2)}
════════════════════════════
Si l'utilisateur demande une modification, base-toi sur cet état pour savoir ce qui existe déjà. Ne remplace que ce qui est explicitement demandé.`;

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: contextNote },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1025,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);

    return NextResponse.json({
      message: parsed.message ?? "Devis mis à jour.",
      update: parsed.update ?? null,
    });
  } catch (err) {
    console.error("[chat/route]", err);
    return NextResponse.json(
      { message: "Erreur serveur. Vérifiez la clé API Groq.", update: null },
      { status: 500 }
    );
  }
}
