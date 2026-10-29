// Accès à la base (schéma « relance »). La sécurité est assurée par la base :
// chaque compte ne voit que ses propres lignes.
import { supabase } from "./supabase";
import { ETAPES_PAR_DEFAUT } from "./relances";
import type { Client, Entreprise, Etape, Facture, Relance, Statut } from "./types";

export interface Donnees {
  entreprise: Entreprise;
  clients: Client[];
  factures: Facture[];
  etapes: Etape[];
  relances: Relance[];
}

function verifier<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** Premier passage : crée la fiche entreprise et le scénario de relance par défaut. */
async function assurerCompte(uid: string, email: string): Promise<Entreprise> {
  const existante = verifier(await supabase.from("entreprises").select("*").eq("id", uid).maybeSingle()) as Entreprise | null;
  if (existante) return existante;
  const e = verifier(
    await supabase.from("entreprises").insert({ id: uid, email }).select("*").single(),
  ) as Entreprise;
  verifier(await supabase.from("etapes").insert(ETAPES_PAR_DEFAUT.map((x) => ({ ...x, entreprise_id: uid }))));
  return e;
}

export async function charger(uid: string, email: string): Promise<Donnees> {
  const entreprise = await assurerCompte(uid, email);
  const [clients, factures, etapes, relances] = await Promise.all([
    supabase.from("clients").select("*").order("nom"),
    supabase.from("factures").select("*").order("echeance"),
    supabase.from("etapes").select("*").order("jours"),
    supabase.from("relances").select("*").order("envoyee_le", { ascending: false }),
  ]);
  return {
    entreprise,
    clients: verifier(clients) as Client[],
    factures: (verifier(factures) as Facture[]).map((f) => ({ ...f, montant: Number(f.montant) })),
    etapes: verifier(etapes) as Etape[],
    relances: verifier(relances) as Relance[],
  };
}

export async function enregistrerEntreprise(e: Entreprise) {
  const { id, ...reste } = e;
  verifier(await supabase.from("entreprises").update(reste).eq("id", id));
}

export async function ajouterClient(c: Omit<Client, "id">): Promise<Client> {
  return verifier(await supabase.from("clients").insert(c).select("*").single()) as Client;
}

export async function majClient(c: Client) {
  const { id, ...reste } = c;
  verifier(await supabase.from("clients").update(reste).eq("id", id));
}

export async function supprimerClient(id: string) {
  verifier(await supabase.from("clients").delete().eq("id", id));
}

export type NouvelleFacture = Omit<Facture, "id" | "statut" | "payee_le" | "pause" | "notes"> & { notes?: string };

export async function ajouterFacture(f: NouvelleFacture) {
  verifier(await supabase.from("factures").insert(f));
}

export async function majFacture(id: string, champs: Partial<Omit<Facture, "id">>) {
  verifier(await supabase.from("factures").update(champs).eq("id", id));
}

export async function changerStatut(id: string, statut: Statut, payeeLe: string | null = null) {
  await majFacture(id, { statut, payee_le: statut === "payee" ? payeeLe : null });
}

export async function supprimerFacture(id: string) {
  verifier(await supabase.from("factures").delete().eq("id", id));
}

export async function enregistrerEtapes(uid: string, etapes: Omit<Etape, "id">[]) {
  verifier(await supabase.from("etapes").delete().eq("entreprise_id", uid));
  if (etapes.length)
    verifier(await supabase.from("etapes").insert(etapes.map((e) => ({ ...e, entreprise_id: uid }))));
}

export async function noterRelance(factureId: string, jours: number, canal = "email"): Promise<Relance> {
  return verifier(
    await supabase.from("relances").insert({ facture_id: factureId, jours, canal }).select("*").single(),
  ) as Relance;
}

export async function annulerRelance(id: string) {
  verifier(await supabase.from("relances").delete().eq("id", id));
}

/** Lignes importées (CSV) : crée les clients manquants puis les factures. */
export async function importer(
  lignes: { client: string; email: string; numero: string; montant: number; emise_le: string; echeance: string }[],
  clientsExistants: Client[],
): Promise<{ ajoutees: number; ignorees: string[] }> {
  const parNom = new Map(clientsExistants.map((c) => [c.nom.trim().toLowerCase(), c]));
  const ignorees: string[] = [];
  let ajoutees = 0;
  for (const l of lignes) {
    const cle = l.client.trim().toLowerCase();
    let c = parNom.get(cle);
    if (!c) {
      c = await ajouterClient({ nom: l.client.trim(), email: l.email.trim(), telephone: "", notes: "" });
      parNom.set(cle, c);
    } else if (!c.email && l.email.trim()) {
      c = { ...c, email: l.email.trim() };
      await majClient(c);
      parNom.set(cle, c);
    }
    const r = await supabase.from("factures").insert({
      client_id: c.id,
      numero: l.numero.trim(),
      montant: l.montant,
      emise_le: l.emise_le,
      echeance: l.echeance,
    });
    if (r.error) ignorees.push(`${l.numero} : ${/duplicate|unique/i.test(r.error.message) ? "numéro déjà présent" : r.error.message}`);
    else ajoutees++;
  }
  return { ajoutees, ignorees };
}
