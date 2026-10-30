// Accès à la base (schéma « relance »). La sécurité est assurée par la base :
// chaque compte ne voit que ses propres lignes.
import { supabase } from "./supabase";
import { ETAPES_PAR_DEFAUT } from "./relances";
import type { Client, Depense, Entreprise, Etape, Facture, LigneBanque, Relance, Statut } from "./types";

export interface Donnees {
  entreprise: Entreprise;
  clients: Client[];
  factures: Facture[];
  etapes: Etape[];
  relances: Relance[];
  depenses: Depense[];
  banque: LigneBanque[];
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
  const [clients, factures, etapes, relances, depenses, banque] = await Promise.all([
    supabase.from("clients").select("*").order("nom"),
    supabase.from("factures").select("*").order("echeance"),
    supabase.from("etapes").select("*").order("jours"),
    supabase.from("relances").select("*").order("envoyee_le", { ascending: false }),
    supabase.from("depenses").select("*").order("date", { ascending: false }),
    supabase.from("banque_lignes").select("*").order("date", { ascending: false }),
  ]);
  const nombre = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    entreprise,
    clients: verifier(clients) as Client[],
    factures: (verifier(factures) as Facture[]).map((f) => ({ ...f, montant: Number(f.montant) })),
    etapes: verifier(etapes) as Etape[],
    relances: verifier(relances) as Relance[],
    // Avant l'installation du module pré-compta sur le serveur, ces tables n'existent pas : on tolère
    depenses: ((depenses.error ? [] : depenses.data) as Depense[]).map((x) => ({
      ...x,
      ttc: Number(x.ttc),
      ht: nombre(x.ht),
      tva: nombre(x.tva),
    })),
    banque: ((banque.error ? [] : banque.data) as LigneBanque[]).map((x) => ({ ...x, montant: Number(x.montant) })),
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

// --- Pré-compta ------------------------------------------------------------------------------

export const BUCKET_PIECES = "relance-pieces";

/** Range le justificatif dans le dossier du compte : <uid>/<AAAA-MM>/<aléatoire>.<ext> */
export async function envoyerPiece(uid: string, date: string, fichier: File): Promise<string> {
  const ext = (fichier.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "pdf";
  const chemin = `${uid}/${date.slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET_PIECES).upload(chemin, fichier, {
    contentType: fichier.type || undefined,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return chemin;
}

export async function lienPiece(chemin: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET_PIECES).createSignedUrl(chemin, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function telechargerPiece(chemin: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET_PIECES).download(chemin);
  if (error) throw new Error(error.message);
  return data;
}

export type NouvelleDepense = Omit<Depense, "id">;

export async function ajouterDepense(d: NouvelleDepense): Promise<Depense> {
  return verifier(await supabase.from("depenses").insert(d).select("*").single()) as Depense;
}

export async function majDepense(id: string, champs: Partial<NouvelleDepense>) {
  verifier(await supabase.from("depenses").update(champs).eq("id", id));
}

export async function supprimerDepense(d: Depense) {
  verifier(await supabase.from("depenses").delete().eq("id", d.id));
  if (d.piece) await supabase.storage.from(BUCKET_PIECES).remove([d.piece]);
}

/** Ajoute les lignes du relevé (les lignes déjà importées sont ignorées grâce à l'empreinte). */
export async function importerBanque(lignes: Omit<LigneBanque, "id" | "depense_id" | "facture_id" | "ignoree">[]) {
  if (!lignes.length) return 0;
  const r = await supabase.from("banque_lignes").upsert(lignes, { onConflict: "entreprise_id,empreinte", ignoreDuplicates: true }).select("id");
  return (verifier(r) as { id: string }[]).length;
}

export async function majLigneBanque(id: string, champs: Partial<Pick<LigneBanque, "depense_id" | "facture_id" | "ignoree">>) {
  verifier(await supabase.from("banque_lignes").update(champs).eq("id", id));
}

/** Associe automatiquement les sorties d'argent à LA dépense de même montant, quand il n'y en a qu'une. */
export async function rapprocherAuto(): Promise<number> {
  const { depensesPossibles } = await import("./precompta");
  const [dep, ban] = await Promise.all([supabase.from("depenses").select("*"), supabase.from("banque_lignes").select("*")]);
  const depenses = (verifier(dep) as Depense[]).map((x) => ({ ...x, ttc: Number(x.ttc) }));
  const banque = (verifier(ban) as LigneBanque[]).map((x) => ({ ...x, montant: Number(x.montant) }));
  let n = 0;
  for (const l of banque) {
    if (l.montant >= 0 || l.depense_id || l.ignoree) continue;
    const possibles = depensesPossibles(l, depenses, banque);
    if (possibles.length !== 1) continue;
    // une même dépense ne doit correspondre qu'à une seule ligne candidate
    const concurrentes = banque.filter(
      (b) => b !== l && b.montant < 0 && !b.depense_id && depensesPossibles(b, depenses, banque).some((x) => x.id === possibles[0].id),
    );
    if (concurrentes.length) continue;
    await majLigneBanque(l.id, { depense_id: possibles[0].id });
    l.depense_id = possibles[0].id;
    n++;
  }
  return n;
}
