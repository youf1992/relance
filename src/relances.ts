// Le cœur de l'app : quelles factures relancer aujourd'hui, et avec quel mail.
import { aujourdhui, dateFr, ecartJours, euros } from "./format";
import type { Client, Entreprise, Etape, Facture, Relance } from "./types";

/** Délai minimum entre deux relances d'une même facture. */
export const ECART_MIN_JOURS = 5;

export const ETAPES_PAR_DEFAUT: Omit<Etape, "id">[] = [
  {
    jours: 3,
    sujet: "Rappel : facture {numero} arrivée à échéance",
    corps: `Bonjour {client},

Sauf erreur de notre part, la facture {numero} d'un montant de {montant}, arrivée à échéance le {echeance}, n'a pas encore été réglée.

Il s'agit sans doute d'un simple oubli : pourriez-vous faire le nécessaire ?
{paiement}

Si le règlement a été effectué entre-temps, merci de ne pas tenir compte de ce message.

Bien cordialement,
{signature}`,
  },
  {
    jours: 10,
    sujet: "Relance : facture {numero} impayée",
    corps: `Bonjour {client},

Nous revenons vers vous au sujet de la facture {numero} d'un montant de {montant}, échue depuis le {echeance} ({retard} jours de retard). Malgré notre précédent rappel, nous n'avons pas encore reçu votre règlement.

Merci de procéder au paiement sous 8 jours.
{paiement}

En cas de difficulté, n'hésitez pas à nous contacter pour trouver une solution.

Cordialement,
{signature}`,
  },
  {
    jours: 20,
    sujet: "Dernier rappel avant recouvrement : facture {numero}",
    corps: `Bonjour {client},

Malgré nos relances, la facture {numero} d'un montant de {montant}, échue le {echeance}, reste impayée à ce jour ({retard} jours de retard).

Sans règlement sous 8 jours, nous serons contraints d'engager une procédure de recouvrement. Entre professionnels, des pénalités de retard et une indemnité forfaitaire de 40 € pour frais de recouvrement sont dues de plein droit (article L441-10 du Code de commerce).
{paiement}

Cordialement,
{signature}`,
  },
];

export const VARIABLES: [string, string][] = [
  ["{client}", "nom du client"],
  ["{numero}", "numéro de facture"],
  ["{montant}", "montant"],
  ["{echeance}", "date d'échéance"],
  ["{retard}", "jours de retard"],
  ["{paiement}", "comment payer (lien et/ou IBAN)"],
  ["{entreprise}", "votre nom d'entreprise"],
  ["{signature}", "votre signature"],
];

function blocPaiement(e: Entreprise | null): string {
  const lignes: string[] = [];
  if (e?.lien_paiement.trim()) lignes.push(`Paiement en ligne : ${e.lien_paiement.trim()}`);
  if (e?.iban.trim()) lignes.push(`Par virement : IBAN ${e.iban.trim()}`);
  return lignes.length ? `\n${lignes.join("\n")}` : "";
}

/** Remplace les {variables} d'un modèle. */
export function remplir(
  modele: string,
  f: Facture,
  c: Client | undefined,
  e: Entreprise | null,
  jour = aujourdhui(),
): string {
  const signature = e?.signature.trim() || [e?.nom, e?.telephone, e?.email].filter(Boolean).join("\n");
  const valeurs: Record<string, string> = {
    "{client}": c?.nom ?? "",
    "{numero}": f.numero,
    "{montant}": euros(f.montant),
    "{echeance}": dateFr(f.echeance),
    "{retard}": String(Math.max(0, ecartJours(jour, f.echeance))),
    "{paiement}": blocPaiement(e),
    "{entreprise}": e?.nom ?? "",
    "{signature}": signature,
  };
  return modele.replace(/\{[a-z]+\}/g, (v) => valeurs[v] ?? v);
}

export interface ARelancer {
  facture: Facture;
  client: Client | undefined;
  etape: Etape;
  retard: number;
}

/** Une facture « vit » tant qu'elle est à payer et pas en pause. */
export const enCours = (f: Facture) => f.statut === "a_payer" && !f.pause;

/** La prochaine étape à envoyer pour une facture, ou null si rien à faire aujourd'hui. */
export function prochaineEtape(f: Facture, etapes: Etape[], relances: Relance[], jour = aujourdhui()): Etape | null {
  if (!enCours(f)) return null;
  const retard = ecartJours(jour, f.echeance);
  const deLaFacture = relances.filter((r) => r.facture_id === f.id);
  const derniere = deLaFacture.reduce<string | null>((m, r) => (!m || r.envoyee_le > m ? r.envoyee_le : m), null);
  if (derniere && ecartJours(jour, derniere.slice(0, 10)) < ECART_MIN_JOURS) return null;
  const envoyees = new Set(deLaFacture.map((r) => r.jours));
  return [...etapes].sort((a, b) => a.jours - b.jours).find((e) => e.jours <= retard && !envoyees.has(e.jours)) ?? null;
}

export function aRelancer(
  factures: Facture[],
  clients: Client[],
  etapes: Etape[],
  relances: Relance[],
  jour = aujourdhui(),
): ARelancer[] {
  const parId = new Map(clients.map((c) => [c.id, c]));
  return factures
    .map((f) => ({ f, e: prochaineEtape(f, etapes, relances, jour) }))
    .filter((x): x is { f: Facture; e: Etape } => x.e !== null)
    .map(({ f, e }) => ({ facture: f, client: parId.get(f.client_id), etape: e, retard: ecartJours(jour, f.echeance) }))
    .sort((a, b) => b.retard - a.retard);
}

/** Toutes les étapes déjà faites et toujours pas payé depuis 7 jours : à traiter à la main. */
export function bloquees(factures: Facture[], etapes: Etape[], relances: Relance[], jour = aujourdhui()): Facture[] {
  if (!etapes.length) return [];
  const derniere = Math.max(...etapes.map((e) => e.jours));
  return factures.filter((f) => {
    if (!enCours(f)) return false;
    const envoyees = new Set(relances.filter((r) => r.facture_id === f.id).map((r) => r.jours));
    return etapes.every((e) => envoyees.has(e.jours)) && ecartJours(jour, f.echeance) >= derniere + 7;
  });
}

/** Lien mailto: avec destinataire, objet et message déjà remplis. */
export function lienMail(destinataire: string, sujet: string, corps: string) {
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, "%20");
  return `mailto:${encodeURIComponent(destinataire.trim())}?subject=${enc(sujet)}&body=${enc(corps)}`;
}
