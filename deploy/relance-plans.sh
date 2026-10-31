#!/bin/sh
# =============================================================================
# Relance : lecture des plans d'architecte par IA pour le module Devis.
# Deux fournisseurs possibles, selon la clé donnée :
#   - OpenRouter (clé sk-or-...) : modèles GRATUITS par défaut (openrouter/free),
#     limités à 50 plans par jour sans crédit acheté, 1000 par jour avec 10 $ de crédit
#   - Google Gemini (clé AIza...)
#
#   - range la clé dans le .env du Supabase podo (jamais dans l'app ni sur GitHub)
#   - installe la fonction serveur « relance-lire-plan »
#   - limite : PLANS_PAR_MOIS plans lus par entreprise et par mois (200 par défaut)
#
# Usage, sur le VPS :  sh relance-plans.sh LA_CLE   (OpenRouter ou Gemini)
# Options : PLANS_PAR_MOIS=300 sh relance-plans.sh LA_CLE   (changer la limite)
#           MODELE=google/gemini-2.5-flash sh relance-plans.sh sk-or-...   (modèle payant précis via OpenRouter)
#           MODELE=gemini-2.5-flash-lite sh relance-plans.sh AIza...         (modèle Gemini)
#           sh relance-plans.sh --retirer                    (désactive la lecture des plans)
# Clés : https://openrouter.ai/settings/keys  ou  https://aistudio.google.com/apikey
# =============================================================================
set -eu
die() { echo "ERREUR : $*" >&2; exit 1; }
log() { printf '\n==> %s\n' "$*"; }

docker inspect podo-db >/dev/null 2>&1 || die "Conteneur podo-db introuvable."
PODO=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' podo-db)
cd "$PODO"
FICHIER=docker-compose.podo-plans.yml

if [ "${1:-}" = "--retirer" ]; then
  log "Retrait de la lecture des plans"
  sed -i "s|:$FICHIER||" .env
  sed -i '/^GEMINI_API_KEY=/d;/^GEMINI_MODELE=/d;/^OPENROUTER_API_KEY=/d;/^OPENROUTER_MODELE=/d;/^PLANS_PAR_MOIS=/d' .env
  rm -f "$FICHIER"
  rm -rf volumes/functions/relance-lire-plan
  docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
  echo "  Fait."
  exit 0
fi

CLE="${1:-}"
LIMITE="${PLANS_PAR_MOIS:-200}"
case "$CLE" in
  sk-or-*)
    FOURNISSEUR=OpenRouter
    MODELE="${MODELE:-openrouter/free}"
    log "Test de la clé OpenRouter"
    CODE=$(curl -s -o /tmp/relance-cle.json -w '%{http_code}' -H "Authorization: Bearer $CLE" https://openrouter.ai/api/v1/key || true)
    [ "$CODE" = 200 ] || die "Clé refusée par OpenRouter (HTTP $CODE). Vérifie-la sur https://openrouter.ai/settings/keys"
    echo "  Clé valide. Modèle : $MODELE"
    rm -f /tmp/relance-cle.json
    LIGNES="OPENROUTER_API_KEY=$CLE
OPENROUTER_MODELE=$MODELE"
    ;;
  AIza*)
    FOURNISSEUR=Gemini
    MODELE="${MODELE:-${GEMINI_MODELE:-gemini-2.5-flash}}"
    log "Test de la clé Gemini"
    CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "x-goog-api-key: $CLE" \
      "https://generativelanguage.googleapis.com/v1beta/models/$MODELE" || true)
    case "$CODE" in
      200) echo "  Clé valide, modèle $MODELE disponible." ;;
      400|403) die "Clé refusée par Google (HTTP $CODE). Vérifie-la sur https://aistudio.google.com/apikey" ;;
      404) die "Modèle $MODELE introuvable. Essaie MODELE=gemini-2.5-flash" ;;
      *) die "Google ne répond pas (HTTP $CODE). Vérifie la connexion du VPS." ;;
    esac
    LIGNES="GEMINI_API_KEY=$CLE
GEMINI_MODELE=$MODELE"
    ;;
  *) die "Donne une clé OpenRouter (sk-or-...) ou Gemini (AIza...) : sh $0 LA_CLE" ;;
esac

log "Réglages"
STAMP=$(date +%Y%m%d-%H%M%S)
cp .env ".env.avant-plans.$STAMP"
sed -i '/^GEMINI_API_KEY=/d;/^GEMINI_MODELE=/d;/^OPENROUTER_API_KEY=/d;/^OPENROUTER_MODELE=/d;/^PLANS_PAR_MOIS=/d' .env
printf '%s\nPLANS_PAR_MOIS=%s\n' "$LIGNES" "$LIMITE" >> .env
# Variables vides pour l'autre fournisseur : une seule IA active à la fois
grep -q '^GEMINI_API_KEY=' .env || printf 'GEMINI_API_KEY=\nGEMINI_MODELE=gemini-2.5-flash\n' >> .env
grep -q '^OPENROUTER_API_KEY=' .env || printf 'OPENROUTER_API_KEY=\nOPENROUTER_MODELE=openrouter/free\n' >> .env
cat > "$FICHIER" <<'YML'
# Lecture des plans (app Relance, module Devis) : la clé reste dans .env, côté serveur.
services:
  functions:
    environment:
      GEMINI_API_KEY: ${GEMINI_API_KEY}
      GEMINI_MODELE: ${GEMINI_MODELE}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      OPENROUTER_MODELE: ${OPENROUTER_MODELE}
      PLANS_PAR_MOIS: ${PLANS_PAR_MOIS}
YML
if grep -q '^COMPOSE_FILE=' .env; then
  grep -q "^COMPOSE_FILE=.*$FICHIER" .env || sed -i "s|^COMPOSE_FILE=\(.*\)$|COMPOSE_FILE=\1:$FICHIER|" .env
else
  printf 'COMPOSE_FILE=docker-compose.yml:%s\n' "$FICHIER" >> .env
fi
docker compose config -q || { cp ".env.avant-plans.$STAMP" .env; rm -f "$FICHIER"; die "Configuration invalide, rien n'a changé."; }
echo "  IA : $FOURNISSEUR ($MODELE). Limite : $LIMITE plans par entreprise et par mois."

log "Fonction serveur relance-lire-plan"
mkdir -p volumes/functions/relance-lire-plan
cat > volumes/functions/relance-lire-plan/index.ts <<'RELANCE_TS'
// Relance : lit un plan d'architecte (PDF ou photo) et propose la liste des pièces à découper.
//
// Le plan est envoyé à une IA qui comprend les images : OpenRouter (modèles gratuits possibles) si
// OPENROUTER_API_KEY est réglée, sinon Google Gemini. La clé est sur NOTRE serveur,
// jamais dans le navigateur. Chaque entreprise a une limite de plans par mois (compteur en base),
// et seules les lectures réussies sont comptées. L'IA propose : l'artisan vérifie avant de chiffrer.

import { createClient } from "npm:@supabase/supabase-js@2";

const CLE = Deno.env.get("GEMINI_API_KEY") ?? "";
const MODELE = Deno.env.get("GEMINI_MODELE") ?? "gemini-2.5-flash";
const API = Deno.env.get("GEMINI_URL") ?? "https://generativelanguage.googleapis.com";
const CLE_OR = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const MODELE_OR = Deno.env.get("OPENROUTER_MODELE") ?? "openrouter/free";
const API_OR = Deno.env.get("OPENROUTER_URL") ?? "https://openrouter.ai/api";
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

type Reponse = { ok: true; texte: string } | { ok: false; erreur: string };

/** Le JSON de la réponse, même entouré de texte, de ```json, ou coupé au milieu (fréquent avec les modèles gratuits). */
function lireJson(texte: string): Record<string, unknown> {
  const t = texte.replace(/<think>[\s\S]*?<\/think>/g, "");
  try {
    return JSON.parse(t);
  } catch {
    /* on essaie autrement */
  }
  const debut = t.indexOf("{");
  const fin = t.lastIndexOf("}");
  if (debut >= 0 && fin > debut) {
    try {
      return JSON.parse(t.slice(debut, fin + 1));
    } catch {
      /* réponse coupée : on récupère ce qui est complet */
    }
  }
  const pieces: unknown[] = [];
  const accessoires: unknown[] = [];
  for (const m of t.matchAll(/\{[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0]);
      if ("longueur" in o && "largeur" in o) pieces.push(o);
      else if ("nom" in o && "quantite" in o) accessoires.push(o);
    } catch {
      /* morceau illisible */
    }
  }
  if (!pieces.length && !accessoires.length) throw new Error("pas de JSON : " + t.slice(0, 300));
  const caissons = Number(/"caissons"\s*:\s*(\d+)/.exec(t)?.[1] ?? 0);
  return { caissons, remarques: "Réponse de l'IA incomplète : vérifiez qu'il ne manque pas de pièces.", pieces, accessoires };
}

async function appelGemini(type: string, donnees: string, consigne: string): Promise<Reponse> {
  const r = await fetch(`${API}/v1beta/models/${MODELE}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": CLE },
    signal: AbortSignal.timeout(110_000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: CONSIGNES }] },
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: type, data: donnees } }, { text: consigne }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
    }),
  });
  if (!r.ok) {
    console.error("gemini", r.status, (await r.text()).slice(0, 500));
    return { ok: false, erreur: r.status === 429 ? "ia_occupee" : "ia_indisponible" };
  }
  const j = await r.json();
  return { ok: true, texte: j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "" };
}

// Modèle de réponse décrit en clair : tous les modèles gratuits ne savent pas suivre un schéma imposé.
const FORMAT_JSON = `Réponds UNIQUEMENT avec un objet JSON, sans texte autour, de la forme :
{"caissons": 2, "remarques": "…", "pieces": [{"nom": "Côté", "longueur": 2400, "largeur": 580, "epaisseur": 19,
"quantite": 2, "chants_longueur": 1, "chants_largeur": 0}], "accessoires": [{"nom": "Charnière", "quantite": 4}]}
Dimensions en millimètres, nombres sans unité.`;

async function appelOpenRouter(type: string, donnees: string, consigne: string, delai: number): Promise<Reponse> {
  if (type === "application/pdf") return { ok: false, erreur: "format" }; // le navigateur envoie une image
  const r = await fetch(`${API_OR}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CLE_OR}`,
      "X-Title": "Relance",
    },
    signal: AbortSignal.timeout(delai),
    body: JSON.stringify({
      model: MODELE_OR,
      temperature: 0,
      max_tokens: 6000,
      messages: [
        { role: "system", content: `${CONSIGNES}\n\n${FORMAT_JSON}` },
        {
          role: "user",
          content: [
            { type: "text", text: consigne },
            { type: "image_url", image_url: { url: `data:${type};base64,${donnees}` } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) {
    console.error("openrouter", r.status, (await r.text()).slice(0, 500));
    // 429 : limite des modèles gratuits (50 par jour sans crédit) ou modèle surchargé
    return { ok: false, erreur: r.status === 429 ? "ia_occupee" : r.status === 402 ? "ia_credit" : "ia_indisponible" };
  }
  const j = await r.json();
  const texte = j?.choices?.[0]?.message?.content;
  if (!texte) {
    console.error("openrouter réponse vide", JSON.stringify(j).slice(0, 300));
    return { ok: false, erreur: "ia_indisponible" };
  }
  return { ok: true, texte: typeof texte === "string" ? texte : texte.map((p: { text?: string }) => p.text ?? "").join("") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return repondre({ erreur: "methode" }, 405);
  if (!CLE && !CLE_OR) return repondre({ erreur: "ia_non_configuree" }, 503);

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
    const consigne = precisions ? `Précisions de l'artisan : ${precisions}` : "Établis la liste de débit de ce plan.";
    let resultat: ReturnType<typeof nettoyer> | null = null;
    let erreur = "ia_indisponible";
    const depart = Date.now();
    const essais = CLE_OR ? 3 : 1;
    for (let i = 1; i <= essais && !resultat; i++) {
      const reste = 140_000 - (Date.now() - depart); // le serveur coupe vers 150 s
      if (reste < 20_000) break;
      try {
        const r = CLE_OR
          ? await appelOpenRouter(type, donnees, consigne, Math.min(70_000, reste))
          : await appelGemini(type, donnees, consigne);
        if (!r.ok) {
          erreur = r.erreur;
          if (["ia_credit", "format"].includes(r.erreur)) break; // inutile de réessayer
          continue;
        }
        resultat = nettoyer(lireJson(r.texte));
      } catch (e) {
        console.error(`relance-lire-plan essai ${i}`, e instanceof Error ? e.message : e);
      }
    }
    if (!resultat) {
      await rendre();
      return repondre({ erreur }, 503);
    }
    // Rien trouvé (pas un plan, plan illisible) : la lecture ne compte pas dans la limite du mois
    if (!resultat.pieces.length && !resultat.accessoires.length) {
      await rendre();
      return repondre({ ...resultat, utilises: total - 1, limite: LIMITE_MOIS });
    }
    return repondre({ ...resultat, utilises: total, limite: LIMITE_MOIS });
  } catch (e) {
    await rendre();
    console.error("relance-lire-plan", e);
    return repondre({ erreur: "ia_indisponible" }, 503);
  }
});
RELANCE_TS
docker compose up -d --no-deps --force-recreate functions >/dev/null 2>&1
echo "  Installée."
echo
echo "Terminé. Dans l'app Relance : Devis > Nouveau devis > « Lire un plan »."
[ "$FOURNISSEUR" = OpenRouter ] && [ "$MODELE" = openrouter/free ] && echo "Modèles gratuits : 50 plans par jour au total sans crédit acheté, qualité variable selon le modèle tiré au sort."
echo "Conseil : fixe un plafond de dépense chez le fournisseur pour ne jamais avoir de surprise."
echo "Pour changer d'IA plus tard : relance ce script avec l'autre clé."
echo "Pour désactiver : sh $0 --retirer"
