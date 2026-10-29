import { useRef, useState } from "react";
import { MODELE_CSV, lireCsv, type ResultatLecture } from "../csv";
import { ajouterClient, ajouterFacture, changerStatut, importer, majFacture, supprimerFacture, type Donnees } from "../donnees";
import { ajouterJours, aujourdhui, dateFr, ecartJours, emailValide, euros, lireMontant } from "../format";
import { lireFacture } from "../lecture";
import type { Facture, Statut } from "../types";
import { Carte, Champ } from "./ui";

type Filtre = "ouvertes" | "retard" | "payees" | "toutes";

const STATUTS: Record<Statut, string> = { a_payer: "À payer", payee: "Payée", litige: "Litige", annulee: "Annulée" };

export function Factures(props: { d: Donnees; recharger: () => Promise<void> }) {
  const { d, recharger } = props;
  const jour = aujourdhui();
  const [filtre, setFiltre] = useState<Filtre>("ouvertes");
  const [ajout, setAjout] = useState(d.factures.length === 0);
  const [importOuvert, setImportOuvert] = useState(false);
  const [erreur, setErreur] = useState("");

  const client = (id: string) => d.clients.find((c) => c.id === id);
  const nbRelances = (id: string) => d.relances.filter((r) => r.facture_id === id).length;
  const liste = d.factures
    .filter((f) =>
      filtre === "ouvertes"
        ? f.statut === "a_payer" || f.statut === "litige"
        : filtre === "retard"
          ? f.statut === "a_payer" && f.echeance < jour
          : filtre === "payees"
            ? f.statut === "payee"
            : true,
    )
    .sort((a, b) => a.echeance.localeCompare(b.echeance));

  async function agir(action: () => Promise<unknown>) {
    setErreur("");
    try {
      await action();
      await recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur, réessayez.");
    }
  }

  return (
    <div className="pile">
      <div className="rangee rangee--entre">
        <div className="pastilles">
          {(
            [
              ["ouvertes", "À encaisser"],
              ["retard", "En retard"],
              ["payees", "Payées"],
              ["toutes", "Toutes"],
            ] as [Filtre, string][]
          ).map(([id, t]) => (
            <button key={id} className={`pastille${filtre === id ? " pastille--active" : ""}`} onClick={() => setFiltre(id)}>
              {t}
            </button>
          ))}
        </div>
        <div className="rangee">
          <button className="bouton bouton--secondaire" onClick={() => setImportOuvert(!importOuvert)}>
            Importer (Excel / CSV)
          </button>
          <button className="bouton" onClick={() => setAjout(!ajout)}>
            + Facture
          </button>
        </div>
      </div>

      {importOuvert && <Import d={d} recharger={recharger} onFini={() => setImportOuvert(false)} />}
      {ajout && <NouvelleFacture d={d} recharger={recharger} onFini={() => setAjout(false)} />}
      {erreur && <p className="erreur">{erreur}</p>}

      <Carte titre={`${liste.length} facture${liste.length > 1 ? "s" : ""}`}>
        {liste.length === 0 ? (
          <p className="discret">Aucune facture ici.</p>
        ) : (
          <ul className="liste">
            {liste.map((f) => (
              <LigneFacture
                key={f.id}
                f={f}
                nomClient={client(f.client_id)?.nom ?? "?"}
                relances={nbRelances(f.id)}
                retard={f.statut === "a_payer" ? ecartJours(jour, f.echeance) : 0}
                agir={agir}
              />
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}

function LigneFacture(props: {
  f: Facture;
  nomClient: string;
  relances: number;
  retard: number;
  agir: (a: () => Promise<unknown>) => void;
}) {
  const { f, agir } = props;
  const jour = aujourdhui();
  const badge =
    f.statut === "payee"
      ? "badge badge--ok"
      : f.statut === "litige"
        ? "badge badge--danger"
        : props.retard > 0
          ? "badge badge--attention"
          : "badge";
  return (
    <li>
      <div className="rangee rangee--entre">
        <div>
          <strong>{props.nomClient}</strong> <span className="discret">· {f.numero}</span>
          <div className="petit discret">
            {euros(f.montant)} · émise le {dateFr(f.emise_le)} · échéance {dateFr(f.echeance)}
            {props.relances > 0 && ` · ${props.relances} relance${props.relances > 1 ? "s" : ""}`}
            {f.statut === "payee" && f.payee_le && ` · payée le ${dateFr(f.payee_le)}`}
            {f.pause && f.statut === "a_payer" && " · relances en pause"}
          </div>
        </div>
        <div className="rangee">
          <span className={badge}>
            {f.statut === "a_payer" && props.retard > 0 ? `${props.retard} j de retard` : STATUTS[f.statut]}
          </span>
          {f.statut === "a_payer" ? (
            <>
              <button className="bouton bouton--petit" onClick={() => agir(() => changerStatut(f.id, "payee", jour))}>
                Payée
              </button>
              <button
                className="bouton bouton--texte bouton--petit"
                onClick={() => agir(() => majFacture(f.id, { pause: !f.pause }))}
              >
                {f.pause ? "Reprendre" : "Pause"}
              </button>
              <button className="bouton bouton--texte bouton--petit" onClick={() => agir(() => changerStatut(f.id, "litige"))}>
                Litige
              </button>
            </>
          ) : (
            <button className="bouton bouton--texte bouton--petit" onClick={() => agir(() => changerStatut(f.id, "a_payer"))}>
              Remettre à payer
            </button>
          )}
          <button
            className="bouton bouton--texte bouton--petit"
            onClick={() => confirm(`Supprimer la facture ${f.numero} et son historique ?`) && agir(() => supprimerFacture(f.id))}
          >
            Supprimer
          </button>
        </div>
      </div>
    </li>
  );
}

function NouvelleFacture(props: { d: Donnees; recharger: () => Promise<void>; onFini: () => void }) {
  const { d } = props;
  const [nomClient, setNomClient] = useState("");
  const [email, setEmail] = useState("");
  const [numero, setNumero] = useState("");
  const [montant, setMontant] = useState("");
  const [emise, setEmise] = useState(aujourdhui());
  const [echeance, setEcheance] = useState(ajouterJours(aujourdhui(), 30));
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [lecture, setLecture] = useState<"" | "en_cours" | string>("");
  const [doutes, setDoutes] = useState<string[]>([]);
  const existant = d.clients.find((c) => c.nom.trim().toLowerCase() === nomClient.trim().toLowerCase());

  async function remplirDepuisPdf(f: File) {
    setErreur("");
    setDoutes([]);
    setLecture("en_cours");
    try {
      const r = await lireFacture(f, d.entreprise.nom);
      // Client déjà connu : on reprend son nom exact
      const connu = d.clients.find((c) => {
        const a = c.nom.toLowerCase(), b = r.client.toLowerCase();
        return b && (a === b || a.includes(b) || b.includes(a));
      });
      if (r.client) setNomClient(connu?.nom ?? r.client);
      if (r.email) setEmail(r.email);
      if (r.numero) setNumero(r.numero);
      if (r.montant > 0) setMontant(r.montant.toFixed(2).replace(".", ","));
      if (r.date) setEmise(r.date);
      setEcheance(r.echeance || ajouterJours(r.date || emise, 30));
      const vides = (["client", "numero", "montant"] as const).filter((k) => !r[k]);
      setDoutes([...r.doutes, ...vides]);
      setLecture(
        r.doutes.length || vides.length
          ? "Facture lue : vérifiez les champs surlignés avant d'ajouter."
          : "Facture lue : vérifiez puis cliquez sur Ajouter.",
      );
    } catch (e) {
      setLecture("");
      setErreur(e instanceof Error ? e.message : "Lecture impossible.");
    }
  }

  const doute = (k: string) => (doutes.includes(k) ? "champ--doute" : "");

  async function valider() {
    setErreur("");
    const m = lireMontant(montant);
    if (!nomClient.trim()) return setErreur("Indiquez le client.");
    if (!numero.trim()) return setErreur("Indiquez le numéro de facture.");
    if (m === null || m <= 0) return setErreur("Montant illisible.");
    if (!echeance) return setErreur("Indiquez l'échéance.");
    if (email && !emailValide(email)) return setErreur("Email du client invalide.");
    setEnCours(true);
    try {
      const c =
        existant ?? (await ajouterClient({ nom: nomClient.trim(), email: email.trim(), telephone: "", notes: "" }));
      await ajouterFacture({ client_id: c.id, numero: numero.trim(), montant: m, emise_le: emise, echeance });
      await props.recharger();
      setNumero("");
      setMontant("");
      setNomClient("");
      setEmail("");
      setDoutes([]);
      setLecture("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      setErreur(/duplicate|unique/i.test(msg) ? "Ce numéro de facture existe déjà." : "Enregistrement impossible, réessayez.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Carte titre="Nouvelle facture à encaisser" actions={<button className="bouton bouton--texte" onClick={props.onFini}>Fermer</button>}>
      <div className="depot-pdf">
        <label className="bouton bouton--secondaire">
          {lecture === "en_cours" ? "Lecture de la facture…" : "Remplir depuis le PDF de la facture"}
          <input
            type="file"
            accept="application/pdf,.pdf"
            hidden
            disabled={lecture === "en_cours"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) remplirDepuisPdf(f);
            }}
          />
        </label>
        <span className="discret petit">Lu par notre IA, sur notre serveur : votre facture ne part chez aucun service extérieur.</span>
      </div>
      {lecture && lecture !== "en_cours" && <p className={doutes.length ? "attention" : "info"}>{lecture}</p>}
      <div className="grille">
        <label className={`champ ${doute("client")}`}>
          <span className="champ__label">
            Client<span className="requis"> *</span>
          </span>
          <input list="liste-clients" value={nomClient} onChange={(e) => setNomClient(e.target.value)} placeholder="Nom du client" />
          <datalist id="liste-clients">
            {d.clients.map((c) => (
              <option key={c.id} value={c.nom} />
            ))}
          </datalist>
        </label>
        {!existant && nomClient.trim() && (
          <Champ label="Email du client" type="email" value={email} onChange={setEmail} aide="Pour lui envoyer les relances" />
        )}
        <div className={doute("numero")}>
          <Champ label="N° de facture" requis value={numero} onChange={setNumero} placeholder="F-2026-001" />
        </div>
        <div className={doute("montant")}>
          <Champ label="Montant TTC (€)" requis value={montant} onChange={setMontant} placeholder="1 250,00" />
        </div>
        <div className={doute("date")}>
          <Champ label="Date de la facture" type="date" value={emise} onChange={(v) => { setEmise(v); if (v) setEcheance(ajouterJours(v, 30)); }} />
        </div>
        <div className={doute("echeance")}>
          <Champ label="Échéance" requis type="date" value={echeance} onChange={setEcheance} aide="Par défaut : 30 jours" />
        </div>
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      <div className="rangee">
        <button className="bouton" disabled={enCours} onClick={valider}>
          {enCours ? "Enregistrement…" : "Ajouter"}
        </button>
      </div>
    </Carte>
  );
}

function Import(props: { d: Donnees; recharger: () => Promise<void>; onFini: () => void }) {
  const [lecture, setLecture] = useState<ResultatLecture | null>(null);
  const [resultat, setResultat] = useState("");
  const [enCours, setEnCours] = useState(false);
  const fichier = useRef<HTMLInputElement>(null);

  async function lire(f: File) {
    setResultat("");
    const octets = new Uint8Array(await f.arrayBuffer());
    // Excel en France enregistre souvent le CSV en Windows-1252 : on essaie UTF-8 puis 1252
    let texte = new TextDecoder("utf-8").decode(octets);
    if (texte.includes("�")) texte = new TextDecoder("windows-1252").decode(octets);
    setLecture(lireCsv(texte));
  }

  async function importerTout() {
    if (!lecture?.lignes.length) return;
    setEnCours(true);
    try {
      const r = await importer(lecture.lignes, props.d.clients);
      await props.recharger();
      setResultat(
        `${r.ajoutees} facture${r.ajoutees > 1 ? "s" : ""} importée${r.ajoutees > 1 ? "s" : ""}.` +
          (r.ignorees.length ? ` Ignorées : ${r.ignorees.join(" ; ")}` : ""),
      );
      setLecture(null);
      if (fichier.current) fichier.current.value = "";
    } catch {
      setResultat("L'import a échoué, réessayez.");
    } finally {
      setEnCours(false);
    }
  }

  function telechargerModele() {
    const url = URL.createObjectURL(new Blob(["﻿" + MODELE_CSV], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "modele-factures.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <Carte
      titre="Importer des factures"
      sousTitre="Depuis Excel : Fichier › Enregistrer sous › CSV. Colonnes : client, email, numero, montant, date, echeance."
      actions={<button className="bouton bouton--texte" onClick={props.onFini}>Fermer</button>}
    >
      <div className="rangee">
        <input ref={fichier} type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && lire(e.target.files[0])} />
        <button className="bouton bouton--texte" onClick={telechargerModele}>
          Télécharger le modèle
        </button>
      </div>
      {lecture && (
        <div className="pile pile--serree">
          <p>
            <strong>{lecture.lignes.length}</strong> facture{lecture.lignes.length > 1 ? "s" : ""} prête
            {lecture.lignes.length > 1 ? "s" : ""} à importer
            {lecture.lignes.length > 0 &&
              ` (${euros(lecture.lignes.reduce((s, l) => s + l.montant, 0))}, ${new Set(lecture.lignes.map((l) => l.client.toLowerCase())).size} clients)`}
            .
          </p>
          {lecture.erreurs.map((e) => (
            <p key={e} className="erreur">
              {e}
            </p>
          ))}
          {lecture.lignes.length > 0 && (
            <button className="bouton" disabled={enCours} onClick={importerTout}>
              {enCours ? "Import…" : "Importer"}
            </button>
          )}
        </div>
      )}
      {resultat && <p className="info">{resultat}</p>}
    </Carte>
  );
}
