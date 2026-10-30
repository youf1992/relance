// Pré-compta : catégories, lecture du relevé bancaire, rapprochement, export pour le comptable.
import { decouper } from "./csv";
import { ecartJours, lireDate, lireMontant } from "./format";
import type { Depense, Facture, LigneBanque } from "./types";

/** Catégories de dépenses, avec le compte du plan comptable le plus courant (indicatif, à valider par le comptable). */
export const CATEGORIES: { id: string; libelle: string; compte: string }[] = [
  { id: "achats", libelle: "Achats, matières, marchandises", compte: "607" },
  { id: "fournitures", libelle: "Fournitures, petit matériel", compte: "6064" },
  { id: "carburant", libelle: "Carburant", compte: "6061" },
  { id: "deplacements", libelle: "Déplacements, péages, parking", compte: "6251" },
  { id: "repas", libelle: "Repas, réceptions", compte: "6257" },
  { id: "telecom", libelle: "Téléphone, internet", compte: "626" },
  { id: "logiciels", libelle: "Logiciels, abonnements", compte: "651" },
  { id: "energie", libelle: "Électricité, eau, gaz", compte: "6061" },
  { id: "loyer", libelle: "Loyer, charges", compte: "6132" },
  { id: "assurance", libelle: "Assurances", compte: "616" },
  { id: "honoraires", libelle: "Comptable, avocat, conseil", compte: "6226" },
  { id: "banque", libelle: "Frais bancaires", compte: "627" },
  { id: "publicite", libelle: "Publicité, impression", compte: "623" },
  { id: "entretien", libelle: "Entretien, réparations", compte: "615" },
  { id: "autre", libelle: "Autre (à classer)", compte: "471" },
];
export const categorie = (id: string) => CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];

// --- Relevé bancaire -------------------------------------------------------------------------

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface LectureReleve {
  lignes: { date: string; libelle: string; montant: number; empreinte: string }[];
  erreurs: string[];
}

/**
 * Lit l'export CSV d'une banque française. Gère :
 *  - les lignes d'en-tête avant le tableau (n° de compte, solde…)
 *  - une colonne « Montant » signée, ou deux colonnes « Débit » / « Crédit »
 */
export function lireReleve(texte: string): LectureReleve {
  const tableau = decouper(texte);
  const iEntete = tableau.findIndex((l) => {
    const h = l.map(norm);
    return h.some((x) => x.startsWith("date")) && h.some((x) => /montant|debit|credit/.test(x));
  });
  if (iEntete < 0) return { lignes: [], erreurs: ["Colonnes introuvables : il faut au moins « Date » et « Montant » (ou « Débit » / « Crédit »)."] };
  const h = tableau[iEntete].map(norm);
  const col = (...res: RegExp[]) => {
    for (const re of res) {
      const i = h.findIndex((x) => re.test(x));
      if (i >= 0) return i;
    }
    return -1;
  };
  const cDate = col(/^dateoperation/, /^dateop/, /^date$/, /^datecomptable/, /^date/);
  const cLib = col(/^libelle/, /^intitule/, /^description/, /^detail/, /^operation/, /^nature/);
  const cMontant = col(/^montant/);
  const cDebit = col(/^debit/);
  const cCredit = col(/^credit/);
  const lignes: LectureReleve["lignes"] = [];
  const erreurs: string[] = [];
  const vus = new Map<string, number>();
  tableau.slice(iEntete + 1).forEach((l, n) => {
    const v = (i: number) => (i >= 0 ? (l[i] ?? "").trim() : "");
    const date = lireDate(v(cDate));
    if (!date) return; // lignes de total, de solde, vides…
    let montant: number | null = null;
    if (cMontant >= 0 && v(cMontant)) montant = lireMontant(v(cMontant).replace(/^\((.*)\)$/, "-$1"));
    else {
      const d = lireMontant(v(cDebit)), c = lireMontant(v(cCredit));
      if (d) montant = -Math.abs(d);
      else if (c) montant = Math.abs(c);
    }
    if (montant === null || montant === 0) {
      if (v(cMontant) || v(cDebit) || v(cCredit)) erreurs.push(`Ligne ${iEntete + n + 2} : montant illisible.`);
      return;
    }
    // Le signe : « -12,50 » est lu par lireMontant sans le moins ; on le rétablit
    if (cMontant >= 0 && /^\s*-/.test(v(cMontant))) montant = -Math.abs(montant);
    const libelle = v(cLib).replace(/\s+/g, " ").slice(0, 200);
    const base = `${date}|${norm(libelle)}|${montant.toFixed(2)}`;
    const rang = (vus.get(base) ?? 0) + 1; // deux lignes identiques le même jour restent distinctes
    vus.set(base, rang);
    lignes.push({ date, libelle, montant: Math.round(montant * 100) / 100, empreinte: `${base}|${rang}` });
  });
  return { lignes, erreurs };
}

// --- Rapprochement ---------------------------------------------------------------------------

const egal = (a: number, b: number) => Math.abs(Math.abs(a) - Math.abs(b)) < 0.005;

/** Dépenses qui peuvent correspondre à une sortie d'argent (même montant, date proche, pas déjà rapprochées). */
export function depensesPossibles(l: LigneBanque, depenses: Depense[], banque: LigneBanque[]): Depense[] {
  const prises = new Set(banque.filter((b) => b.depense_id && b.id !== l.id).map((b) => b.depense_id));
  return depenses.filter((d) => {
    const ecart = ecartJours(l.date, d.date); // le débit arrive le jour même ou après la facture
    return !prises.has(d.id) && egal(d.ttc, l.montant) && ecart >= -5 && ecart <= 60;
  });
}

/** Factures à encaisser qui peuvent correspondre à une entrée d'argent. */
export function facturesPossibles(l: LigneBanque, factures: Facture[], banque: LigneBanque[]): Facture[] {
  const prises = new Set(banque.filter((b) => b.facture_id && b.id !== l.id).map((b) => b.facture_id));
  return factures.filter(
    (f) => f.statut === "a_payer" && !prises.has(f.id) && egal(f.montant, l.montant) && ecartJours(l.date, f.emise_le) >= -2,
  );
}

/** Sorties d'argent sans justificatif (ni rapprochées, ni marquées « pas besoin »). */
export const piecesManquantes = (banque: LigneBanque[]) => banque.filter((l) => l.montant < 0 && !l.depense_id && !l.ignoree);

// --- Export comptable ------------------------------------------------------------------------

const montantCsv = (n: number | null | undefined) => (n === null || n === undefined ? "" : n.toFixed(2).replace(".", ","));
const champ = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const dateCsv = (iso: string) => iso.split("-").reverse().join("/");

export const nomPiece = (d: Depense) =>
  `${d.date}_${d.fournisseur.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}_${montantCsv(d.ttc)}` +
  (d.piece ? `.${d.piece.split(".").pop()}` : "");

export function csvDepenses(depenses: Depense[]): string {
  const lignes = [
    ["Date", "Fournisseur", "N° pièce", "Catégorie", "Compte suggéré", "HT", "TVA", "TTC", "Justificatif"].join(";"),
    ...[...depenses]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) =>
        [
          dateCsv(d.date),
          champ(d.fournisseur),
          champ(d.numero),
          champ(categorie(d.categorie).libelle),
          categorie(d.categorie).compte,
          montantCsv(d.ht),
          montantCsv(d.tva),
          montantCsv(d.ttc),
          d.piece ? champ(nomPiece(d)) : "MANQUANT",
        ].join(";"),
      ),
  ];
  return "﻿" + lignes.join("\r\n") + "\r\n";
}

export function csvEncaissements(factures: Facture[], nomClient: (id: string) => string): string {
  const lignes = [
    ["Date d'encaissement", "Client", "N° facture", "Montant TTC"].join(";"),
    ...[...factures]
      .sort((a, b) => (a.payee_le ?? "").localeCompare(b.payee_le ?? ""))
      .map((f) => [dateCsv(f.payee_le ?? f.echeance), champ(nomClient(f.client_id)), champ(f.numero), montantCsv(f.montant)].join(";")),
  ];
  return "﻿" + lignes.join("\r\n") + "\r\n";
}
