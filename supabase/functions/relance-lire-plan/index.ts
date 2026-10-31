// Relance : lit un plan d'architecte (PDF ou photo) et propose la liste des pièces à découper.
//
// Le plan est envoyé à Google Gemini (modèle qui comprend les images). La clé est sur NOTRE serveur,
// jamais dans le navigateur. Chaque entreprise a une limite de plans par mois (compteur en base),
// et seules les lectures réussies sont comptées. L'IA propose : l'artisan vérifie avant de chiffrer.

import { createClient } from "npm:@supabase/supabase-js@2";

const CLE = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODELE = Deno.env.get("GEMINI_MODELE") ?? "gemini-2.5-flash";
const API = Deno.env.get("GEMINI_URL") ?? "https://generativelanguage.googleapis.com";
const LIMITE_MOIS = Number(Deno.env.get("PLANS_PAR_MOIS") ?? "200");
const MAX_OCTETS = 7 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const repondre = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SCHEMA = {
  type: "OBJECT",
  properties: {
    caissons: { type: "INTEGER", description: "nombre de caissons / modules / colonnes du meuble" },
    remarques: { type: "STRING", description: "ce qui est incertain ou absent du plan, en français, court" },
    pieces: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nom: { type: "STRING", description: "côté, dessus, étagère, porte, façade de tiroir, fond…" },
          longueur: { type: "INTEGER", description: "en millimètres (la plus grande dimension)" },
          largeur: { type: "INTEGER", description: "en millimètres" },
          epaisseur: { type: "INTEGER", description: "en millimètres, 19 par défaut, 3 à 8 pour un fond" },
          quantite: { type: "INTEGER" },
          chants_longueur: { type: "INTEGER", description: "côtés longs visibles à plaquer : 0, 1 ou 2" },
          chants_largeur: { type: "INTEGER", description: "côtés courts visibles à plaquer : 0, 1 ou 2" },
        },
        required: ["nom", "longueur", "largeur", "epaisseur", "quantite", "chants_longueur", "chants_largeur"],
      },
    },
    accessoires: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          nom: { type: "STRING", description: "charnière, coulisses de tiroir (paire), taquet, barre de penderie, poignée…" },
          quantite: { type: "NUMBER", description: "pièces, ou mètres pour une barre de penderie" },
        },
        required: ["nom", "quantite"],
      },
    },
  },
  required: ["caissons", "remarques", "pieces", "accessoires"],
};

const CONSIGNES = `Tu es métreur en menuiserie d'agencement (placards, dressings, meubles sur mesure en panneaux).
À partir du plan, établis la liste de débit : chaque pièce de panneau à découper, avec ses dimensions finies en millimètres.
- Lis les cotes écrites sur le plan. Si une cote manque, déduis-la des autres cotes et signale-le dans « remarques ».
- Compte l'épaisseur des panneaux (19 mm par défaut) : par exemple, une étagère entre deux côtés mesure la largeur intérieure.
- Regroupe les pièces identiques (quantite).
- Chants : seulement les côtés visibles (devant des côtés et des étagères, tour des portes et façades).
- Accessoires : charnières (2 par porte jusqu'à 1 m de haut, 3 au-delà, 4 au-delà de 2 m), coulisses (1 paire par tiroir),
  taquets (4 par étagère réglable), barre de penderie (en mètres), poignées.
- N'invente pas de meuble qui n'est pas sur le plan. Si le document n'est pas un plan de meuble, renvoie des listes vides
  et explique-le dans « remarques ».`;

const entier = (n: unknown, min: number, max: number) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : min;
};

function nettoyer(brut: Record<string, unknown>) {
  const pieces = (Array.isArray(brut.pieces) ? brut.pieces : [])
    .map((p: Record<string, unknown>) => {
      const a = entier(p.longueur, 0, 6000);
      const b = entier(p.largeur, 0, 6000);
      const ca = entier(p.chants_longueur, 0, 2);
      const cb = entier(p.chants_largeur, 0, 2);
      const inverse = b > a; // on remet la plus grande dimension en longueur, chants compris
      return {
        nom: String(p.nom ?? "").trim().slice(0, 60),
        longueur: inverse ? b : a,
        largeur: inverse ? a : b,
        epaisseur: entier(p.epaisseur, 0, 60),
        quantite: entier(p.quantite, 1, 500),
        chants_longueur: inverse ? cb : ca,
        chants_largeur: inverse ? ca : cb,
      };
    })
    .filter((p) => p.longueur >= 20 && p.largeur >= 20)
    .slice(0, 200);
  const accessoires = (Array.isArray(brut.accessoires) ? brut.accessoires : [])
    .map((x: Record<string, unknown>) => ({
      nom: String(x.nom ?? "").trim().slice(0, 60),
      quantite: Math.max(0, Math.min(1000, Math.round(Number(x.quantite) * 10) / 10 || 0)),
    }))
    .filter((x) => x.nom && x.quantite > 0)
    .slice(0, 50);
  return {
    caissons: entier(brut.caissons, 0, 200),
    remarques: String(brut.remarques ?? "").trim().slice(0, 800),
    pieces,
    accessoires,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return repondre({ erreur: "methode" }, 405);
  if (!CLE) return repondre({ erreur: "ia_non_configuree" }, 503);

  const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "relance" },
  });
  const { data: auth } = await admin.auth.getUser(jeton);
  const uid = auth?.user?.id;
  if (!uid) return repondre({ erreur: "non_connecte" }, 401);

  let corps: { donnees?: unknown; type?: unknown; precisions?: unknown };
  try {
    corps = await req.json();
  } catch {
    return repondre({ erreur: "requete" }, 400);
  }
  const type = String(corps.type ?? "");
  const donnees = String(corps.donnees ?? "");
  if (!TYPES.includes(type) || !/^[A-Za-z0-9+/=]+$/.test(donnees)) return repondre({ erreur: "format" }, 400);
  if ((donnees.length * 3) / 4 > MAX_OCTETS) return repondre({ erreur: "trop_gros" }, 413);
  const precisions = String(corps.precisions ?? "").slice(0, 500);

  // Compte la lecture AVANT l'appel (pas de dépassement si plusieurs envois en même temps)
  const { data: total, error: errCompte } = await admin.rpc("compter_plan", { p_entreprise: uid, p_limite: LIMITE_MOIS });
  if (errCompte) {
    console.error("compter_plan", errCompte);
    return repondre({ erreur: "ia_indisponible" }, 503);
  }
  if (total === -1) return repondre({ erreur: "limite_mois", limite: LIMITE_MOIS }, 429);

  const rendre = () => admin.rpc("rendre_plan", { p_entreprise: uid }).then(() => {});
  try {
    const r = await fetch(`${API}/v1beta/models/${MODELE}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": CLE },
      signal: AbortSignal.timeout(110_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: CONSIGNES }] },
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: type, data: donnees } },
              { text: precisions ? `Précisions de l'artisan : ${precisions}` : "Établis la liste de débit de ce plan." },
            ],
          },
        ],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    });
    if (!r.ok) {
      await rendre();
      console.error("gemini", r.status, (await r.text()).slice(0, 500));
      return repondre({ erreur: r.status === 429 ? "ia_occupee" : "ia_indisponible" }, 503);
    }
    const j = await r.json();
    const texte = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
    const resultat = nettoyer(JSON.parse(texte || "{}"));
    return repondre({ ...resultat, utilises: total, limite: LIMITE_MOIS });
  } catch (e) {
    await rendre();
    console.error("relance-lire-plan", e);
    return repondre({ erreur: "ia_indisponible" }, 503);
  }
});
