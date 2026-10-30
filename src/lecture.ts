// Lecture automatique d'une facture PDF.
// 1. Le texte est extrait ici, dans le navigateur (pdf.js).
// 2. Il est lu par un petit modèle d'IA open source installé sur NOTRE serveur
//    (fonction « relance-lire-facture ») : aucun service extérieur.
import { supabase } from "./supabase";

export interface FactureLue {
  client: string;
  email: string;
  numero: string;
  montant: number;
  date: string;
  echeance: string;
  /** Champs que l'IA a proposés mais qu'on n'a pas retrouvés tels quels dans le PDF. */
  doutes: string[];
}

export async function texteDuPdf(fichier: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const chargement = pdfjs.getDocument({ data: new Uint8Array(await fichier.arrayBuffer()) });
  try {
    const doc = await chargement.promise;
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
      const contenu = await (await doc.getPage(n)).getTextContent();
      // On recompose les lignes : un retour à la ligne quand la position verticale change
      let ligne = "";
      let y: number | null = null;
      const lignes: string[] = [];
      for (const item of contenu.items) {
        if (!("str" in item)) continue;
        const yItem = Math.round(item.transform[5]);
        if (y !== null && Math.abs(yItem - y) > 2) {
          lignes.push(ligne.trim());
          ligne = "";
        }
        ligne += (ligne && !ligne.endsWith(" ") ? " " : "") + item.str;
        y = yItem;
      }
      lignes.push(ligne.trim());
      pages.push(lignes.filter(Boolean).join("\n"));
    }
    return pages.join("\n\n");
  } finally {
    await chargement.destroy();
  }
}

const MESSAGES: Record<string, string> = {
  texte_vide: "Ce PDF ne contient pas de texte (facture scannée ou photo) : saisissez-la à la main.",
  trop_de_demandes: "Trop de lectures en une heure : patientez un peu ou saisissez à la main.",
  ia_indisponible: "La lecture automatique est indisponible pour le moment : saisissez à la main.",
  non_connecte: "Session expirée : reconnectez-vous.",
};

export async function lireFacture(fichier: File, entreprise: string): Promise<FactureLue> {
  const texte = await texteDuPdf(fichier);
  if (texte.replace(/\s/g, "").length < 30) throw new Error(MESSAGES.texte_vide);
  const { data, error } = await supabase.functions.invoke("relance-lire-facture", { body: { texte, entreprise } });
  if (error) {
    let code = "ia_indisponible";
    try {
      const corps = await (error as { context?: Response }).context?.json();
      if (corps?.erreur) code = corps.erreur;
    } catch {
      /* réponse illisible */
    }
    throw new Error(MESSAGES[code] ?? MESSAGES.ia_indisponible);
  }
  return data as FactureLue;
}

export interface DepenseLue {
  fournisseur: string;
  numero: string;
  date: string;
  ht: number;
  tva: number;
  ttc: number;
  categorie: string;
  doutes: string[];
}

/** Facture fournisseur (PDF avec texte) : lecture par règles puis par notre IA, sur notre serveur. */
export async function lireDepense(fichier: File, entreprise: string): Promise<DepenseLue> {
  const texte = await texteDuPdf(fichier);
  if (texte.replace(/\s/g, "").length < 30) throw new Error(MESSAGES.texte_vide);
  const { data, error } = await supabase.functions.invoke("relance-lire-facture", {
    body: { texte, entreprise, type: "achat" },
  });
  if (error) {
    let code = "ia_indisponible";
    try {
      const corps = await (error as { context?: Response }).context?.json();
      if (corps?.erreur) code = corps.erreur;
    } catch {
      /* réponse illisible */
    }
    throw new Error(MESSAGES[code] ?? MESSAGES.ia_indisponible);
  }
  return data as DepenseLue;
}
