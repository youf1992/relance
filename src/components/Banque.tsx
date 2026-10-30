import { useState } from "react";
import { changerStatut, importerBanque, majLigneBanque, rapprocherAuto, type Donnees } from "../donnees";
import { dateFr, euros } from "../format";
import { depensesPossibles, facturesPossibles, lireReleve, piecesManquantes, type LectureReleve } from "../precompta";
import type { LigneBanque } from "../types";
import type { DepenseDepuisBanque } from "./Depenses";
import { Carte } from "./ui";

export function Banque(props: {
  d: Donnees;
  recharger: () => Promise<void>;
  ajouterJustificatif: (x: DepenseDepuisBanque) => void;
}) {
  const { d, recharger } = props;
  const [lecture, setLecture] = useState<LectureReleve | null>(null);
  const [info, setInfo] = useState("");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [toutVoir, setToutVoir] = useState(false);

  const client = (id: string) => d.clients.find((c) => c.id === id)?.nom ?? "";
  const manquantes = piecesManquantes(d.banque);
  const encaissements = d.banque
    .filter((l) => l.montant > 0 && !l.facture_id && !l.ignoree)
    .map((l) => ({ l, factures: facturesPossibles(l, d.factures, d.banque) }))
    .filter((x) => x.factures.length > 0);

  async function agir(action: () => Promise<unknown>) {
    setErreur("");
    try {
      await action();
      await recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur, réessayez.");
    }
  }

  async function lire(f: File) {
    setInfo("");
    const octets = new Uint8Array(await f.arrayBuffer());
    let texte = new TextDecoder("utf-8").decode(octets);
    if (texte.includes("�")) texte = new TextDecoder("windows-1252").decode(octets);
    setLecture(lireReleve(texte));
  }

  async function importer() {
    if (!lecture?.lignes.length) return;
    setEnCours(true);
    setErreur("");
    try {
      const ajoutees = await importerBanque(lecture.lignes);
      const associees = await rapprocherAuto();
      await recharger();
      setInfo(
        `${ajoutees} nouvelle${ajoutees > 1 ? "s" : ""} ligne${ajoutees > 1 ? "s" : ""} importée${ajoutees > 1 ? "s" : ""}` +
          (lecture.lignes.length - ajoutees > 0 ? ` (${lecture.lignes.length - ajoutees} déjà présentes).` : ".") +
          (associees ? ` ${associees} associée${associees > 1 ? "s" : ""} automatiquement à vos dépenses.` : ""),
      );
      setLecture(null);
    } catch (e) {
      setErreur(e instanceof Error ? `Import impossible : ${e.message}` : "Import impossible.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="pile">
      <Carte
        titre="Importer le relevé de compte"
        sousTitre="Dans votre banque en ligne : Comptes › Exporter les opérations › format CSV (ou Excel CSV). Vous pouvez réimporter le même fichier : les lignes déjà présentes sont ignorées."
      >
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => e.target.files?.[0] && lire(e.target.files[0])} />
        {lecture && (
          <div className="pile pile--serree">
            <p>
              <strong>{lecture.lignes.length}</strong> opération{lecture.lignes.length > 1 ? "s" : ""} trouvée
              {lecture.lignes.length > 1 ? "s" : ""}
              {lecture.lignes.length > 0 &&
                ` : ${lecture.lignes.filter((l) => l.montant < 0).length} sorties, ${lecture.lignes.filter((l) => l.montant > 0).length} entrées`}
              .
            </p>
            {lecture.erreurs.slice(0, 5).map((e) => (
              <p key={e} className="erreur">
                {e}
              </p>
            ))}
            {lecture.lignes.length > 0 && (
              <button className="bouton" disabled={enCours} onClick={importer}>
                {enCours ? "Import…" : "Importer"}
              </button>
            )}
          </div>
        )}
        {info && <p className="info">{info}</p>}
        <p className="discret petit">Le relevé reste dans votre compte : il sert uniquement à retrouver les justificatifs manquants et les paiements reçus.</p>
      </Carte>

      {erreur && <p className="erreur">{erreur}</p>}

      {encaissements.length > 0 && (
        <Carte
          titre={`${encaissements.length} paiement${encaissements.length > 1 ? "s" : ""} reçu${encaissements.length > 1 ? "s" : ""} à confirmer`}
          sousTitre="Ces entrées d'argent ont le montant exact d'une facture à encaisser. Confirmez : la facture passe en payée et ses relances s'arrêtent."
        >
          <ul className="liste">
            {encaissements.map(({ l, factures }) => (
              <li key={l.id}>
                <div className="rangee rangee--entre">
                  <span>
                    <strong>+{euros(l.montant)}</strong> le {dateFr(l.date)} <span className="discret">· {l.libelle}</span>
                  </span>
                  <span className="rangee">
                    {factures.slice(0, 3).map((f) => (
                      <button
                        key={f.id}
                        className="bouton bouton--petit"
                        onClick={() =>
                          agir(async () => {
                            await changerStatut(f.id, "payee", l.date);
                            await majLigneBanque(l.id, { facture_id: f.id });
                          })
                        }
                      >
                        Payée : {client(f.client_id)} · {f.numero}
                      </button>
                    ))}
                    <button className="bouton bouton--texte bouton--petit" onClick={() => agir(() => majLigneBanque(l.id, { ignoree: true }))}>
                      Non, autre chose
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Carte>
      )}

      <Carte
        titre={manquantes.length ? `${manquantes.length} justificatif${manquantes.length > 1 ? "s" : ""} manquant${manquantes.length > 1 ? "s" : ""}` : "Aucun justificatif manquant"}
        sousTitre={
          manquantes.length
            ? "Sorties d'argent du relevé sans facture associée. Votre comptable vous les demandera : ajoutez-les maintenant."
            : d.banque.length
              ? "Toutes les sorties d'argent ont leur justificatif."
              : "Importez votre relevé pour voir les justificatifs qui manquent."
        }
      >
        <ul className="liste">
          {manquantes.slice(0, 50).map((l) => (
            <LigneManquante key={l.id} l={l} d={d} agir={agir} ajouter={props.ajouterJustificatif} />
          ))}
        </ul>
        {manquantes.length > 50 && <p className="discret">… et {manquantes.length - 50} autres.</p>}
      </Carte>

      {d.banque.length > 0 && (
        <Carte
          titre={`Relevé : ${d.banque.length} opérations`}
          actions={
            <button className="bouton bouton--texte" onClick={() => setToutVoir(!toutVoir)}>
              {toutVoir ? "Masquer" : "Tout voir"}
            </button>
          }
        >
          {toutVoir && (
            <ul className="liste">
              {d.banque.slice(0, 300).map((l) => (
                <li key={l.id} className="rangee rangee--entre petit">
                  <span>
                    {dateFr(l.date)} · {l.libelle}
                  </span>
                  <span className="rangee">
                    <strong className={l.montant < 0 ? "erreur-texte" : ""}>{euros(l.montant)}</strong>
                    {l.depense_id && <span className="badge badge--ok">justifiée</span>}
                    {l.facture_id && <span className="badge badge--ok">facture payée</span>}
                    {l.ignoree && (
                      <button className="bouton bouton--texte bouton--petit" onClick={() => agir(() => majLigneBanque(l.id, { ignoree: false }))}>
                        ignorée (annuler)
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Carte>
      )}
    </div>
  );
}

function LigneManquante(props: {
  l: LigneBanque;
  d: Donnees;
  agir: (a: () => Promise<unknown>) => void;
  ajouter: (x: DepenseDepuisBanque) => void;
}) {
  const { l, d, agir } = props;
  const possibles = depensesPossibles(l, d.depenses, d.banque);
  return (
    <li>
      <div className="rangee rangee--entre">
        <span>
          <strong>{euros(l.montant)}</strong> le {dateFr(l.date)} <span className="discret">· {l.libelle}</span>
        </span>
        <span className="rangee">
          {possibles.slice(0, 2).map((x) => (
            <button key={x.id} className="bouton bouton--secondaire bouton--petit" onClick={() => agir(() => majLigneBanque(l.id, { depense_id: x.id }))}>
              C'est : {x.fournisseur} du {dateFr(x.date)}
            </button>
          ))}
          <button
            className="bouton bouton--petit"
            onClick={() => props.ajouter({ ligneId: l.id, date: l.date, ttc: l.montant, libelle: l.libelle })}
          >
            Ajouter le justificatif
          </button>
          <button
            className="bouton bouton--texte bouton--petit"
            title="Virement entre vos comptes, salaire, impôt… : pas de facture à fournir"
            onClick={() => agir(() => majLigneBanque(l.id, { ignoree: true }))}
          >
            Pas besoin
          </button>
        </span>
      </div>
    </li>
  );
}
