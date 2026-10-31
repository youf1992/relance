// Accès à la base pour le module Devis (schéma « relance », chacun ne voit que ses lignes).
import { supabase } from "./supabase";
import { ajouterJours, aujourdhui } from "./format";
import {
  ARTICLES_EXEMPLE,
  REGLAGES_PAR_DEFAUT,
  type Article,
  type Fourniture,
  type Piece,
  type Reglages,
} from "./devis";

export type StatutDevis = "brouillon" | "envoye" | "accepte" | "refuse";

export interface Devis {
  id: string;
  client_id: string | null;
  numero: string;
  titre: string;
  date: string;
  statut: StatutDevis;
  caissons: number;
  difficulte: number;
  transport_ht: number;
  heures_sup: number;
  pieces: Piece[];
  fournitures: Fourniture[];
  notes: string;
  total_ht: number;
  total_ttc: number;
  heures_prevues: number;
  heures_reelles: number | null;
  facture_id: string | null;
}

export interface DonneesDevis {
  reglages: Reglages;
  articles: Article[];
  devis: Devis[];
  plansCeMois: number;
  installe: boolean; // false si les tables ne sont pas encore créées sur le serveur
}

function verifier<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

const num = (x: unknown) => Number(x ?? 0);
const numOuNull = (x: unknown) => (x === null || x === undefined ? null : Number(x));

export async function chargerDevis(uid: string): Promise<DonneesDevis> {
  const reg = await supabase.from("devis_reglages").select("*").eq("entreprise_id", uid).maybeSingle();
  if (reg.error) {
    // Tables absentes = module pas encore installé sur le VPS
    if (/does not exist|schema cache|Could not find/i.test(reg.error.message))
      return { reglages: REGLAGES_PAR_DEFAUT, articles: [], devis: [], plansCeMois: 0, installe: false };
    throw new Error(reg.error.message);
  }
  let reglages = reg.data as (Reglages & { entreprise_id: string }) | null;
  if (!reglages) {
    // Premier passage : réglages par défaut + catalogue d'exemple.
    // Si deux onglets arrivent en même temps, un seul crée la ligne (et donc le catalogue).
    const cree = verifier(
      await supabase
        .from("devis_reglages")
        .upsert({ entreprise_id: uid }, { onConflict: "entreprise_id", ignoreDuplicates: true })
        .select("*"),
    ) as (Reglages & { entreprise_id: string })[];
    if (cree.length) verifier(await supabase.from("devis_articles").insert(ARTICLES_EXEMPLE));
    reglages = cree[0] ?? (verifier(await supabase.from("devis_reglages").select("*").eq("entreprise_id", uid).single()) as Reglages & {
      entreprise_id: string;
    });
  }
  const [art, dev, ia] = await Promise.all([
    supabase.from("devis_articles").select("*").order("categorie").order("nom"),
    supabase.from("devis").select("*").order("date", { ascending: false }).order("numero", { ascending: false }),
    supabase.from("ia_usage").select("plans").eq("mois", aujourdhui().slice(0, 7)).maybeSingle(),
  ]);
  const r = reglages as unknown as Record<string, unknown>;
  const nombres = Object.fromEntries(
    Object.entries(REGLAGES_PAR_DEFAUT).map(([k, v]) => [k, typeof v === "number" ? num(r[k]) : (r[k] ?? v)]),
  ) as unknown as Reglages;
  return {
    reglages: nombres,
    articles: (verifier(art) as Article[]).map((a) => ({
      ...a,
      prix_ht: num(a.prix_ht),
      minutes_pose: numOuNull(a.minutes_pose),
    })),
    devis: (verifier(dev) as Devis[]).map((d) => ({
      ...d,
      caissons: num(d.caissons),
      difficulte: num(d.difficulte),
      transport_ht: num(d.transport_ht),
      heures_sup: num(d.heures_sup),
      total_ht: num(d.total_ht),
      total_ttc: num(d.total_ttc),
      heures_prevues: num(d.heures_prevues),
      heures_reelles: numOuNull(d.heures_reelles),
    })),
    plansCeMois: (ia.data as { plans: number } | null)?.plans ?? 0,
    installe: true,
  };
}

export async function enregistrerReglages(uid: string, r: Reglages) {
  verifier(await supabase.from("devis_reglages").update(r).eq("entreprise_id", uid));
}

export async function enregistrerArticle(a: Omit<Article, "id"> & { id?: string }) {
  const { id, ...reste } = a;
  if (id) verifier(await supabase.from("devis_articles").update(reste).eq("id", id));
  else verifier(await supabase.from("devis_articles").insert(reste));
}

export async function supprimerArticle(id: string) {
  verifier(await supabase.from("devis_articles").delete().eq("id", id));
}

export type DevisAEnregistrer = Omit<Devis, "id" | "facture_id" | "heures_reelles"> & { id?: string };

export async function enregistrerDevis(d: DevisAEnregistrer): Promise<Devis> {
  const { id, ...reste } = d;
  const r = id
    ? await supabase.from("devis").update(reste).eq("id", id).select("*").single()
    : await supabase.from("devis").insert(reste).select("*").single();
  if (r.error && /duplicate|unique/i.test(r.error.message)) throw new Error("Ce numéro de devis existe déjà.");
  return verifier(r) as Devis;
}

export async function majDevis(id: string, champs: Partial<Pick<Devis, "statut" | "heures_reelles" | "facture_id">>) {
  verifier(await supabase.from("devis").update(champs).eq("id", id));
}

export async function supprimerDevis(id: string) {
  verifier(await supabase.from("devis").delete().eq("id", id));
}

/** Devis accepté → facture à encaisser (la relance des impayés prend le relais). */
export async function facturerDevis(d: Devis, numeroFacture: string, delaiJours: number) {
  if (!d.client_id) throw new Error("Choisissez d'abord le client du devis.");
  const emise = aujourdhui();
  const f = await supabase
    .from("factures")
    .insert({
      client_id: d.client_id,
      numero: numeroFacture.trim(),
      montant: d.total_ttc,
      emise_le: emise,
      echeance: ajouterJours(emise, delaiJours),
      notes: `Devis ${d.numero}${d.titre ? ` – ${d.titre}` : ""}`,
    })
    .select("id")
    .single();
  if (f.error && /duplicate|unique/i.test(f.error.message)) throw new Error("Ce numéro de facture existe déjà.");
  const { id } = verifier(f) as { id: string };
  await majDevis(d.id, { facture_id: id, statut: "accepte" });
}

// --- Lecture de plan par IA ----------------------------------------------------------------

export interface PlanLu {
  caissons: number;
  remarques: string;
  pieces: {
    nom: string;
    longueur: number;
    largeur: number;
    epaisseur: number;
    quantite: number;
    chants_longueur: number;
    chants_largeur: number;
  }[];
  accessoires: { nom: string; quantite: number }[];
  utilises: number;
  limite: number;
}

const MESSAGES: Record<string, string> = {
  ia_non_configuree: "La lecture des plans n'est pas encore activée sur le serveur.",
  limite_mois: "Limite de plans lus ce mois-ci atteinte : remplissez les pièces à la main.",
  ia_occupee: "L'IA est très demandée en ce moment : réessayez dans une minute.",
  ia_indisponible: "La lecture du plan est indisponible pour le moment : remplissez les pièces à la main.",
  trop_gros: "Fichier trop lourd (7 Mo maximum) : envoyez une photo ou un PDF plus léger.",
  format: "Format non reconnu : envoyez un PDF, une photo JPG ou PNG.",
  non_connecte: "Session expirée : reconnectez-vous.",
};

const enBase64 = (octets: Uint8Array) => {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(s);
};

/** Photo : réduite à 3000 px de côté maximum (assez pour lire les cotes, beaucoup plus léger). */
async function photoReduite(f: File): Promise<{ type: string; donnees: string }> {
  const img = await createImageBitmap(f);
  const echelle = Math.min(1, 3000 / Math.max(img.width, img.height));
  const toile = document.createElement("canvas");
  toile.width = Math.round(img.width * echelle);
  toile.height = Math.round(img.height * echelle);
  toile.getContext("2d")!.drawImage(img, 0, 0, toile.width, toile.height);
  img.close();
  const blob = await new Promise<Blob>((ok, ko) => toile.toBlob((b) => (b ? ok(b) : ko(new Error("image"))), "image/jpeg", 0.88));
  return { type: "image/jpeg", donnees: enBase64(new Uint8Array(await blob.arrayBuffer())) };
}

export async function lirePlan(f: File, precisions: string): Promise<PlanLu> {
  const estPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
  if (estPdf && f.size > 7 * 1024 * 1024) throw new Error(MESSAGES.trop_gros);
  const corps = estPdf
    ? { type: "application/pdf", donnees: enBase64(new Uint8Array(await f.arrayBuffer())) }
    : await photoReduite(f).catch(() => {
        throw new Error(MESSAGES.format);
      });
  const { data, error } = await supabase.functions.invoke("relance-lire-plan", { body: { ...corps, precisions } });
  if (error) {
    let code = "ia_indisponible";
    try {
      const c = await (error as { context?: Response }).context?.json();
      if (c?.erreur) code = c.erreur;
    } catch {
      /* réponse illisible */
    }
    throw new Error(MESSAGES[code] ?? MESSAGES.ia_indisponible);
  }
  return data as PlanLu;
}
