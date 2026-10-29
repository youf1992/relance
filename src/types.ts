export interface Entreprise {
  id: string;
  nom: string;
  email: string;
  telephone: string;
  signature: string;
  iban: string;
  lien_paiement: string;
}

export interface Client {
  id: string;
  nom: string;
  email: string;
  telephone: string;
  notes: string;
}

export type Statut = "a_payer" | "payee" | "litige" | "annulee";

export interface Facture {
  id: string;
  client_id: string;
  numero: string;
  montant: number;
  emise_le: string; // AAAA-MM-JJ
  echeance: string;
  statut: Statut;
  payee_le: string | null;
  pause: boolean;
  notes: string;
}

export interface Etape {
  id: string;
  jours: number;
  sujet: string;
  corps: string;
}

export interface Relance {
  id: string;
  facture_id: string;
  jours: number;
  canal: string;
  envoyee_le: string;
}
