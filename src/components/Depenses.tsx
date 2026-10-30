import { useState } from "react";
import { zipSync } from "fflate";
import {
  ajouterDepense,
  envoyerPiece,
  lienPiece,
  majDepense,
  majLigneBanque,
  supprimerDepense,
  telechargerPiece,
  type Donnees,
} from "../donnees";
import { aujourdhui, dateFr, euros, lireMontant } from "../format";
import { lireDepense } from "../lecture";
import { CATEGORIES, categorie, csvDepenses, csvEncaissements, nomPiece, piecesManquantes } from "../precompta";
import type { Depense } from "../types";
import { Carte, Champ } from "./ui";

/** Valeurs de départ quand on ajoute le justificatif d'une ligne du relevé. */
export interface DepenseDepuisBanque {
  ligneId: string;
  date: string;
  ttc: number;
  libelle: string;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const libelleMois = (m: string) => `${MOIS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const moisPrecedent = (m: string, n = 1) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 - n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export function Depenses(props: {
  d: Donnees;
  uid: string;
  recharger: () => Promise<void>;
  depuisBanque: DepenseDepuisBanque | null;
  finDepuisBanque: () => void;
}) {
  const { d, recharger } = props;
  const [mois, setMois] = useState(aujourdhui().slice(0, 7));
  const [ajout, setAjout] = useState(false);
  const [erreur, setErreur] = useState("");
  const [exportEnCours, setExportEnCours] = useState("");

  const duMois = d.depenses.filter((x) => x.date.startsWith(mois));
  const total = duMois.reduce((s, x) => s + x.ttc, 0);
  const tva = duMois.reduce((s, x) => s + (x.tva ?? 0), 0);
  const sansPiece = duMois.filter((x) => !x.piece).length;
  const manquantes = piecesManquantes(d.banque).filter((l) => l.date.startsWith(mois)).length;
  const encaisses = d.factures.filter((f) => f.statut === "payee" && f.payee_le?.startsWith(mois));
  const nomClient = (id: string) => d.clients.find((c) => c.id === id)?.nom ?? "";

  async function agir(action: () => Promise<unknown>) {
    setErreur("");
    try {
      await action();
      await recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur, réessayez.");
    }
  }

  async function voir(x: Depense) {
    if (!x.piece) return;
    const fenetre = window.open("", "_blank");
    try {
      const url = await lienPiece(x.piece);
      if (fenetre) fenetre.location.href = url;
      else window.location.href = url;
    } catch {
      fenetre?.close();
      setErreur("Justificatif introuvable.");
    }
  }

  async function exporter() {
    setErreur("");
    setExportEnCours("Préparation…");
    try {
      const fichiers: Record<string, Uint8Array> = {
        [`depenses-${mois}.csv`]: new TextEncoder().encode(csvDepenses(duMois)),
        [`encaissements-${mois}.csv`]: new TextEncoder().encode(csvEncaissements(encaisses, nomClient)),
      };
      const avecPiece = duMois.filter((x) => x.piece);
      for (const [i, x] of avecPiece.entries()) {
        setExportEnCours(`Justificatifs ${i + 1}/${avecPiece.length}…`);
        fichiers[`justificatifs/${nomPiece(x)}`] = new Uint8Array(await (await telechargerPiece(x.piece!)).arrayBuffer());
      }
      const zip = zipSync(fichiers, { level: 0 });
      const url = URL.createObjectURL(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `compta-${mois}-${(d.entreprise.nom || "entreprise").replace(/[^a-zA-Z0-9]+/g, "-")}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErreur(e instanceof Error ? `Export impossible : ${e.message}` : "Export impossible.");
    } finally {
      setExportEnCours("");
    }
  }

  const formulaireOuvert = ajout || !!props.depuisBanque;

  return (
    <div className="pile">
      <div className="rangee rangee--entre">
        <div className="rangee">
          <button className="bouton bouton--texte" onClick={() => setMois(moisPrecedent(mois))} aria-label="Mois précédent">
            ‹
          </button>
          <strong className="mois">{libelleMois(mois)}</strong>
          <button className="bouton bouton--texte" onClick={() => setMois(moisPrecedent(mois, -1))} aria-label="Mois suivant">
            ›
          </button>
        </div>
        <div className="rangee">
          <button className="bouton bouton--secondaire" disabled={!!exportEnCours} onClick={exporter}>
            {exportEnCours || "Export pour le comptable (ZIP)"}
          </button>
          <button className="bouton" onClick={() => setAjout(true)}>
            + Dépense
          </button>
        </div>
      </div>

      <div className="chiffres">
        <div className="chiffre">
          <span>Dépenses du mois</span>
          <strong>{euros(total)}</strong>
          <small>
            {duMois.length} pièce{duMois.length > 1 ? "s" : ""} · TVA {euros(tva)}
          </small>
        </div>
        <div className="chiffre chiffre--ok">
          <span>Encaissé ce mois</span>
          <strong>{euros(encaisses.reduce((s, f) => s + f.montant, 0))}</strong>
          <small>
            {encaisses.length} facture{encaisses.length > 1 ? "s" : ""} payée{encaisses.length > 1 ? "s" : ""}
          </small>
        </div>
        <div className={`chiffre${manquantes + sansPiece ? " chiffre--attention" : ""}`}>
          <span>Justificatifs manquants</span>
          <strong>{manquantes + sansPiece}</strong>
          <small>{manquantes} au relevé · {sansPiece} sans fichier</small>
        </div>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}

      {formulaireOuvert && (
        <NouvelleDepense
          d={d}
          uid={props.uid}
          initial={props.depuisBanque}
          onFini={async (cree) => {
            if (cree && props.depuisBanque) await majLigneBanque(props.depuisBanque.ligneId, { depense_id: cree.id });
            setAjout(false);
            props.finDepuisBanque();
            await recharger();
            if (cree) setMois(cree.date.slice(0, 7));
          }}
        />
      )}

      <Carte titre={`${duMois.length} dépense${duMois.length > 1 ? "s" : ""} en ${libelleMois(mois)}`}>
        {duMois.length === 0 ? (
          <p className="discret">Aucune dépense ce mois-ci. Déposez vos factures fournisseurs et tickets avec « + Dépense ».</p>
        ) : (
          <ul className="liste">
            {duMois.map((x) => (
              <LigneDepense
                key={x.id}
                x={x}
                uid={props.uid}
                onVoir={() => voir(x)}
                agir={agir}
              />
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}

function LigneDepense(props: { x: Depense; uid: string; onVoir: () => void; agir: (a: () => Promise<unknown>) => void }) {
  const { x, agir } = props;
  return (
    <li>
      <div className="rangee rangee--entre">
        <div>
          <strong>{x.fournisseur}</strong> <span className="discret">· {dateFr(x.date)}{x.numero && ` · ${x.numero}`}</span>
          <div className="petit discret">
            {x.ht !== null && `HT ${euros(x.ht)} · `}
            {x.tva !== null && `TVA ${euros(x.tva)} · `}
            <strong>TTC {euros(x.ttc)}</strong>
          </div>
        </div>
        <div className="rangee">
          <select
            className="select-petit"
            value={x.categorie}
            onChange={(e) => agir(() => majDepense(x.id, { categorie: e.target.value }))}
            aria-label="Catégorie"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle}
              </option>
            ))}
          </select>
          {x.piece ? (
            <button className="bouton bouton--texte bouton--petit" onClick={props.onVoir}>
              Justificatif
            </button>
          ) : (
            <label className="bouton bouton--secondaire bouton--petit">
              Ajouter le justificatif
              <input
                type="file"
                hidden
                accept="application/pdf,image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) agir(async () => majDepense(x.id, { piece: await envoyerPiece(props.uid, x.date, f) }));
                }}
              />
            </label>
          )}
          <button
            className="bouton bouton--texte bouton--petit"
            onClick={() => confirm(`Supprimer la dépense ${x.fournisseur} (${euros(x.ttc)}) ?`) && agir(() => supprimerDepense(x))}
          >
            Supprimer
          </button>
        </div>
      </div>
    </li>
  );
}

function NouvelleDepense(props: {
  d: Donnees;
  uid: string;
  initial: DepenseDepuisBanque | null;
  onFini: (cree: Depense | null) => Promise<void>;
}) {
  const ini = props.initial;
  const [fichier, setFichier] = useState<File | null>(null);
  const [fournisseur, setFournisseur] = useState(ini?.libelle.replace(/^(prlv|cb|carte|vir|prelevement)\s*(sepa)?\s*/i, "").slice(0, 60) ?? "");
  const [date, setDate] = useState(ini?.date ?? aujourdhui());
  const [numero, setNumero] = useState("");
  const [cat, setCat] = useState("autre");
  const [ht, setHt] = useState("");
  const [tva, setTva] = useState("");
  const [ttc, setTtc] = useState(ini ? Math.abs(ini.ttc).toFixed(2).replace(".", ",") : "");
  const [lecture, setLecture] = useState("");
  const [doutes, setDoutes] = useState<string[]>([]);
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const doute = (k: string) => (doutes.includes(k) ? "champ--doute" : "");
  const virgule = (n: number) => (n ? n.toFixed(2).replace(".", ",") : "");

  async function choisir(f: File) {
    setFichier(f);
    setErreur("");
    setDoutes([]);
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) {
      setLecture("Photo jointe comme justificatif : complétez les montants à la main.");
      return;
    }
    setLecture("en_cours");
    try {
      const r = await lireDepense(f, props.d.entreprise.nom);
      if (r.fournisseur) setFournisseur(r.fournisseur);
      if (r.date) setDate(r.date);
      if (r.numero) setNumero(r.numero);
      if (r.categorie) setCat(r.categorie);
      if (r.ht) setHt(virgule(r.ht));
      if (r.tva) setTva(virgule(r.tva));
      if (r.ttc) setTtc(virgule(r.ttc));
      setDoutes(r.doutes);
      setLecture(r.doutes.length ? "Facture lue : vérifiez les champs surlignés." : "Facture lue : vérifiez puis enregistrez.");
    } catch (e) {
      setLecture("");
      setErreur(e instanceof Error ? e.message : "Lecture impossible : complétez à la main.");
    }
  }

  async function enregistrer() {
    setErreur("");
    const nTtc = lireMontant(ttc);
    const nHt = ht ? lireMontant(ht) : null;
    const nTva = tva ? lireMontant(tva) : null;
    if (!fournisseur.trim()) return setErreur("Indiquez le fournisseur.");
    if (!date) return setErreur("Indiquez la date.");
    if (nTtc === null || nTtc <= 0) return setErreur("Montant TTC illisible.");
    if (ht && nHt === null) return setErreur("Montant HT illisible.");
    if (tva && nTva === null) return setErreur("TVA illisible.");
    setEnCours(true);
    try {
      const piece = fichier ? await envoyerPiece(props.uid, date, fichier) : null;
      const cree = await ajouterDepense({
        fournisseur: fournisseur.trim(),
        numero: numero.trim(),
        date,
        ht: nHt,
        tva: nTva,
        ttc: nTtc,
        categorie: cat,
        piece,
        notes: "",
      });
      await props.onFini(cree);
    } catch (e) {
      setErreur(e instanceof Error ? `Enregistrement impossible : ${e.message}` : "Enregistrement impossible.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Carte
      titre={ini ? `Justificatif pour « ${ini.libelle} »` : "Nouvelle dépense"}
      actions={
        <button className="bouton bouton--texte" onClick={() => props.onFini(null)}>
          Fermer
        </button>
      }
    >
      <div className="depot-pdf">
        <label className="bouton bouton--secondaire">
          {lecture === "en_cours" ? "Lecture… (jusqu'à 1 min)" : fichier ? `Fichier : ${fichier.name.slice(0, 30)}` : "Joindre la facture (PDF) ou la photo du ticket"}
          <input
            type="file"
            hidden
            accept="application/pdf,image/*"
            disabled={lecture === "en_cours"}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) choisir(f);
            }}
          />
        </label>
        <span className="discret petit">Les PDF sont lus automatiquement, sur notre serveur.</span>
      </div>
      {lecture && lecture !== "en_cours" && <p className={doutes.length ? "attention" : "info"}>{lecture}</p>}
      <div className="grille">
        <div className={doute("fournisseur")}>
          <Champ label="Fournisseur" requis value={fournisseur} onChange={setFournisseur} />
        </div>
        <div className={doute("date")}>
          <Champ label="Date" requis type="date" value={date} onChange={setDate} />
        </div>
        <Champ label="N° de facture" value={numero} onChange={setNumero} />
        <label className="champ">
          <span className="champ__label">Catégorie</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.libelle}
              </option>
            ))}
          </select>
        </label>
        <Champ label="Montant HT" value={ht} onChange={setHt} placeholder="facultatif" />
        <div className={doute("tva")}>
          <Champ label="TVA" value={tva} onChange={setTva} placeholder="facultatif" />
        </div>
        <div className={doute("ttc")}>
          <Champ label="Montant TTC" requis value={ttc} onChange={setTtc} />
        </div>
      </div>
      <p className="discret petit">Compte suggéré au comptable : {categorie(cat).compte}</p>
      {erreur && <p className="erreur">{erreur}</p>}
      <button className="bouton" disabled={enCours || lecture === "en_cours"} onClick={enregistrer}>
        {enCours ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Carte>
  );
}
