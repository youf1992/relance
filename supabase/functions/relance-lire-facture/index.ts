// Relance : lit le texte d'une facture PDF et en extrait client, numéro, montant, dates.
//
// Le texte est extrait dans le navigateur (pdf.js) puis lu ici par un petit modèle d'IA
// open source (Ollama, sur notre propre serveur) : la facture ne part chez aucun service extérieur.
// L'IA peut se tromper : chaque valeur est vérifiée dans le texte, et l'utilisateur valide.

import { createClient } from "npm:@supabase/supabase-js@2";

const OLLAMA = Deno.env.get("OLLAMA_URL") ?? "http://ollama:11434";
const MODELE = Deno.env.get("OLLAMA_MODELE") ?? "qwen3:1.7b";
const MAX_TEXTE = 6000;
const MAX_PAR_HEURE = 40;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const repondre = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const appels = new Map<string, number[]>();
function tropDAppels(uid: string) {
  const maintenant = Date.now();
  const liste = (appels.get(uid) ?? []).filter((t) => maintenant - t < 3_600_000);
  liste.push(maintenant);
  appels.set(uid, liste);
  return liste.length > MAX_PAR_HEURE;
}

const SCHEMA = {
  type: "object",
  properties: {
    client: { type: "string" },
    email: { type: "string" },
    numero: { type: "string" },
    montant: { type: "number" },
    date: { type: "string" },
    echeance: { type: "string" },
  },
  required: ["client", "email", "numero", "montant", "date", "echeance"],
};

// --- Vérifications : on ne garde que ce qu'on retrouve dans le texte -----------------------

const sansAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Tous les montants écrits dans le texte (« 1 250,50 », « 1250.50 », « 1.250,50 €»…). */
function montantsDuTexte(texte: string): number[] {
  const res: number[] = [];
  for (const m of texte.matchAll(/\d{1,3}(?:[   .,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/g)) {
    const brut = m[0].replace(/[\s  ]/g, "");
    const i = Math.max(brut.lastIndexOf(","), brut.lastIndexOf("."));
    const n =
      i >= 0 && brut.length - i - 1 <= 2
        ? Number(brut.slice(0, i).replace(/[,.]/g, "") + "." + brut.slice(i + 1))
        : Number(brut.replace(/[,.]/g, ""));
    if (Number.isFinite(n)) res.push(n);
  }
  return res;
}

function dateValide(s: string): string {
  const t = String(s ?? "").trim();
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  let a: number, m: number, j: number;
  if (r) [a, m, j] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [j, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return "";
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || a < 2000 || a > 2100) return "";
  return `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}

/** La date apparaît-elle dans le texte (sous forme 31/12/2026, 2026-12-31 ou 31 décembre 2026) ? */
function dateDansTexte(iso: string, texte: string): boolean {
  if (!iso) return false;
  const [a, m, j] = iso.split("-");
  const mois = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
  const t = sansAccent(texte).replace(/\s+/g, " ");
  const jj = String(Number(j));
  return [
    `${j}/${m}/${a}`, `${jj}/${m}/${a}`, `${j}.${m}.${a}`, `${j}-${m}-${a}`, iso,
    `${j}/${m}/${a.slice(2)}`, `${jj} ${mois[Number(m) - 1]} ${a}`, `${j} ${mois[Number(m) - 1]} ${a}`,
  ].some((f) => t.includes(f));
}

function verifier(brut: Record<string, unknown>, texte: string) {
  const doutes: string[] = [];
  const t = sansAccent(texte);
  const res = {
    client: String(brut.client ?? "").trim().slice(0, 120),
    email: String(brut.email ?? "").trim().toLowerCase(),
    numero: String(brut.numero ?? "").trim().slice(0, 60),
    montant: Math.round(Number(brut.montant ?? 0) * 100) / 100,
    date: dateValide(String(brut.date ?? "")),
    echeance: dateValide(String(brut.echeance ?? "")),
  };
  if (res.email && !t.includes(res.email)) res.email = "";
  if (res.numero && !t.replace(/\s/g, "").includes(sansAccent(res.numero).replace(/\s/g, ""))) doutes.push("numero");
  if (res.client) {
    const mots = sansAccent(res.client).split(/[^a-z0-9]+/).filter((m) => m.length > 2);
    if (mots.length && !mots.some((m) => t.includes(m))) doutes.push("client");
  }
  if (!(res.montant > 0) || !montantsDuTexte(texte).some((n) => Math.abs(n - res.montant) < 0.005)) {
    doutes.push("montant");
    if (!(res.montant > 0)) res.montant = 0;
  }
  if (res.date && !dateDansTexte(res.date, texte)) doutes.push("date");
  if (res.echeance && !dateDansTexte(res.echeance, texte)) doutes.push("echeance");
  return { ...res, doutes };
}

// --- Lecture « à l'ancienne » par règles : sert de filet quand l'IA hésite ---------------

const RE_DATE = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/;

function regles(texte: string) {
  const lignes = texte.split("\n").map((l) => l.trim()).filter(Boolean);
  const res = { client: "", email: "", numero: "", montant: 0, date: "", echeance: "" };
  const dateDe = (l: string) => {
    const m = RE_DATE.exec(l);
    return m ? dateValide(`${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`) : "";
  };
  for (const l of lignes) {
    const ls = sansAccent(l);
    if (!res.numero) {
      const m = /(?:facture|invoice|n[°o]|numero)\s*(?:n[°o]|numero|#)?\s*[:.]?\s*([a-z0-9][a-z0-9\-/_.]{2,})/i.exec(l);
      if (m && /\d/.test(m[1])) res.numero = m[1];
    }
    if (!res.echeance && /(echeance|a regler avant|date limite|payable avant|due)/.test(ls)) res.echeance = dateDe(l);
    else if (!res.date && /date/.test(ls) && !/echeance|limite/.test(ls)) res.date = dateDe(l);
    if (/(total\s*ttc|net\s*a\s*payer|montant\s*ttc|total\s*a\s*payer|reste\s*a\s*payer|^montant\b|^total\s*:)/.test(ls)) {
      const ms = montantsDuTexte(l).filter((n) => n > 0);
      if (ms.length) res.montant = ms[ms.length - 1];
    }
  }
  // Client : la ligne après « Facturé à », « Client », « Destinataire »
  const i = lignes.findIndex((l) => /^(facture a|client|destinataire|adresse de facturation)\b/.test(sansAccent(l)));
  if (i >= 0) {
    // « Facturé à : X » / « Client Dupont » sur la même ligne, sinon la ligne suivante
    const apres = lignes[i].replace(/^\s*(factur[ée]e?\s+[àa]|client|destinataire|adresse de facturation)\s*:?\s*/i, "").trim();
    res.client = apres || lignes[i + 1] || "";
    const bloc = lignes.slice(i, i + 6).join(" ");
    res.email = (/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(bloc)?.[0] ?? "").toLowerCase();
  }
  return res;
}

/**
 * Les règles sont prioritaires quand elles trouvent quelque chose : elles s'appuient sur
 * des repères sûrs (« Total TTC », « Échéance », « Facturé à »). L'IA complète le reste.
 */
function fusionner(ia: ReturnType<typeof verifier>, texte: string, entreprise: string) {
  const r = regles(texte);
  const res = { ...ia, doutes: [...ia.doutes] };
  for (const k of ["client", "numero", "montant", "date", "echeance", "email"] as const) {
    if (r[k]) {
      (res as Record<string, unknown>)[k] = r[k];
      res.doutes = res.doutes.filter((d) => d !== k);
    }
  }
  // Le client ne peut pas être l'émetteur (erreur fréquente des petits modèles)
  const mots = sansAccent(entreprise).split(/[^a-z0-9]+/).filter((m) => m.length > 2);
  if (res.client && mots.some((m) => sansAccent(res.client).includes(m))) {
    res.client = "";
    if (!res.doutes.includes("client")) res.doutes.push("client");
  }
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return repondre({ erreur: "methode" }, 405);

  const jeton = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth } = await admin.auth.getUser(jeton);
  const uid = auth?.user?.id;
  if (!uid) return repondre({ erreur: "non_connecte" }, 401);
  if (tropDAppels(uid)) return repondre({ erreur: "trop_de_demandes" }, 429);

  let corps: { texte?: unknown; entreprise?: unknown };
  try {
    corps = await req.json();
  } catch {
    return repondre({ erreur: "requete" }, 400);
  }
  const texte = String(corps.texte ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXTE);
  const entreprise = String(corps.entreprise ?? "").slice(0, 120);
  if (texte.length < 30) return repondre({ erreur: "texte_vide" }, 400);

  const consignes =
    "Tu lis une facture et tu en extrais les informations, en JSON. N'invente rien : " +
    "si une information n'est pas dans le texte, mets une chaîne vide (ou 0 pour le montant).\n" +
    (entreprise ? `La facture est ÉMISE par « ${entreprise} ». ` : "") +
    "client = le DESTINATAIRE de la facture (la personne ou l'entreprise facturée), jamais l'émetteur.\n" +
    "email = l'email du client s'il est écrit.\n" +
    "numero = le numéro de la facture.\n" +
    "montant = le total TTC à payer, en nombre (ex. 1250.5).\n" +
    "date = la date de la facture, echeance = la date limite de paiement, au format AAAA-MM-JJ.";

  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: MODELE,
        stream: false,
        think: false,
        format: SCHEMA,
        // num_predict : une réponse JSON fait ~80 mots ; sans limite, un petit modèle
        // peut boucler (espaces sans fin) et occuper le processeur plusieurs minutes.
        options: { temperature: 0, num_ctx: 4096, num_predict: 256 },
        messages: [
          { role: "system", content: consignes },
          { role: "user", content: texte },
        ],
      }),
    });
    if (!r.ok) throw new Error(`ollama ${r.status} ${await r.text()}`);
    const j = await r.json();
    let brut: Record<string, unknown> = {};
    try {
      brut = JSON.parse(j?.message?.content ?? "{}");
    } catch {
      /* réponse coupée : on se rabat sur les règles */
    }
    return repondre(fusionner(verifier(brut, texte), texte, entreprise));
  } catch (e) {
    // IA trop lente ou indisponible : lecture par règles seulement
    console.error("relance-lire-facture", e);
    const r = regles(texte);
    if (!r.numero && !r.montant) return repondre({ erreur: "ia_indisponible" }, 503);
    return repondre(fusionner(verifier(r, texte), texte, entreprise));
  }
});
