// Import d'un fichier CSV (export de l'outil de facturation ou d'Excel).
import { ajouterJours, aujourdhui, lireDate, lireMontant } from "./format";

/** Découpe un CSV (séparateur ; , ou tabulation, guillemets gérés). */
export function decouper(texte: string): string[][] {
  const t = texte.replace(/^﻿/, "");
  const premiere = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].map((s) => [s, premiere.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (guillemets) {
      if (ch === '"' && t[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (ch === '"') guillemets = false;
      else champ += ch;
    } else if (ch === '"') guillemets = true;
    else if (ch === sep) {
      ligne.push(champ);
      champ = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      ligne.push(champ);
      champ = "";
      if (ligne.some((c) => c.trim())) lignes.push(ligne);
      ligne = [];
    } else champ += ch;
  }
  ligne.push(champ);
  if (ligne.some((c) => c.trim())) lignes.push(ligne);
  return lignes;
}

const sansAccent = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const COLONNES: Record<string, RegExp> = {
  client: /^(client|nom|raisonsociale|societe|entreprise|destinataire|nomclient)/,
  email: /(email|mail|courriel)/,
  numero: /^(numero.*|num|no|n|nfacture|nodefacture|facture|ref|reference)$/,
  montant: /(montant|ttc|total|somme|resteapayer|solde)/,
  emise_le: /^(date|emission|emise|datefacture|datedemission)/,
  echeance: /(echeance|datelimite|aregleravant|duedate)/,
};

export interface LigneImport {
  client: string;
  email: string;
  numero: string;
  montant: number;
  emise_le: string;
  echeance: string;
}

export interface ResultatLecture {
  lignes: LigneImport[];
  erreurs: string[];
}

export function lireCsv(texte: string): ResultatLecture {
  const tableau = decouper(texte);
  if (tableau.length < 2) return { lignes: [], erreurs: ["Le fichier est vide ou n'a qu'une ligne."] };
  const entetes = tableau[0].map(sansAccent);
  const index: Partial<Record<keyof LigneImport, number>> = {};
  // l'échéance d'abord : « date d'échéance » ne doit pas être prise pour la date d'émission
  for (const cle of ["echeance", "email", "montant", "numero", "client", "emise_le"] as (keyof LigneImport)[]) {
    const i = entetes.findIndex((h, n) => COLONNES[cle].test(h) && !Object.values(index).includes(n));
    if (i >= 0) index[cle] = i;
  }
  const manquantes = (["client", "numero", "montant"] as const).filter((c) => index[c] === undefined);
  if (manquantes.length)
    return {
      lignes: [],
      erreurs: [`Colonnes introuvables : ${manquantes.join(", ")}. La 1re ligne doit contenir les titres (voir le modèle).`],
    };

  const lignes: LigneImport[] = [];
  const erreurs: string[] = [];
  const val = (l: string[], c: keyof LigneImport) => (index[c] === undefined ? "" : (l[index[c]!] ?? "").trim());
  tableau.slice(1).forEach((l, n) => {
    const num = n + 2;
    const client = val(l, "client");
    const numero = val(l, "numero");
    const montant = lireMontant(val(l, "montant"));
    if (!client || !numero) return erreurs.push(`Ligne ${num} : client ou numéro manquant.`);
    if (montant === null || montant <= 0) return erreurs.push(`Ligne ${num} : montant illisible (« ${val(l, "montant")} »).`);
    const emise = val(l, "emise_le") ? lireDate(val(l, "emise_le")) : aujourdhui();
    if (!emise) return erreurs.push(`Ligne ${num} : date illisible (« ${val(l, "emise_le")} »).`);
    const echeance = val(l, "echeance") ? lireDate(val(l, "echeance")) : ajouterJours(emise, 30);
    if (!echeance) return erreurs.push(`Ligne ${num} : échéance illisible (« ${val(l, "echeance")} »).`);
    lignes.push({ client, email: val(l, "email"), numero, montant, emise_le: emise, echeance });
  });
  return { lignes, erreurs };
}

export const MODELE_CSV =
  "client;email;numero;montant;date;echeance\nDupont SARL;compta@dupont.fr;F-2026-001;1 250,00;01/10/2026;31/10/2026\n";
