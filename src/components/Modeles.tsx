import { useState } from "react";
import { enregistrerEtapes, type Donnees } from "../donnees";
import { ajouterJours, aujourdhui } from "../format";
import { ETAPES_PAR_DEFAUT, VARIABLES, remplir } from "../relances";
import type { Etape } from "../types";
import { Carte, Zone } from "./ui";

type Brouillon = Omit<Etape, "id">;

export function Modeles(props: { d: Donnees; uid: string; recharger: () => Promise<void> }) {
  const [etapes, setEtapes] = useState<Brouillon[]>(
    [...props.d.etapes].sort((a, b) => a.jours - b.jours).map(({ jours, sujet, corps }) => ({ jours, sujet, corps })),
  );
  const [info, setInfo] = useState("");
  const [erreur, setErreur] = useState("");

  // Exemple pour l'aperçu
  const exempleFacture = {
    id: "x",
    client_id: "x",
    numero: "F-2026-042",
    montant: 1250,
    emise_le: ajouterJours(aujourdhui(), -40),
    echeance: ajouterJours(aujourdhui(), -10),
    statut: "a_payer" as const,
    payee_le: null,
    pause: false,
    notes: "",
  };
  const exempleClient = { id: "x", nom: "Dupont SARL", email: "", telephone: "", notes: "" };

  const maj = (i: number, champs: Partial<Brouillon>) => {
    setInfo("");
    setEtapes((l) => l.map((e, n) => (n === i ? { ...e, ...champs } : e)));
  };

  async function enregistrer() {
    setErreur("");
    const jours = etapes.map((e) => e.jours);
    if (new Set(jours).size !== jours.length) return setErreur("Deux relances ont le même nombre de jours.");
    if (etapes.some((e) => !e.sujet.trim() || !e.corps.trim())) return setErreur("Chaque relance doit avoir un objet et un message.");
    try {
      await enregistrerEtapes(props.uid, etapes);
      await props.recharger();
      setInfo("Mails de relance enregistrés.");
    } catch {
      setErreur("Enregistrement impossible, réessayez.");
    }
  }

  return (
    <div className="pile">
      <p className="intro">
        Chaque facture impayée reçoit ces mails, dans l'ordre, après son échéance (au moins 5 jours entre deux relances).
        Les mots entre accolades sont remplacés automatiquement :{" "}
        {VARIABLES.map(([v, t]) => (
          <span key={v} title={t}>
            <code>{v}</code>{" "}
          </span>
        ))}
      </p>
      {etapes.map((e, i) => (
        <Carte
          key={i}
          titre={`Relance ${i + 1}`}
          actions={
            <button className="bouton bouton--texte" onClick={() => setEtapes((l) => l.filter((_, n) => n !== i))}>
              Retirer
            </button>
          }
        >
          <div className="grille">
            <label className="champ">
              <span className="champ__label">Jours après l'échéance</span>
              <input type="number" min={-60} max={365} value={e.jours} onChange={(ev) => maj(i, { jours: Number(ev.target.value) })} />
            </label>
            <label className="champ champ--large">
              <span className="champ__label">Objet du mail</span>
              <input value={e.sujet} onChange={(ev) => maj(i, { sujet: ev.target.value })} />
            </label>
          </div>
          <Zone label="Message" value={e.corps} onChange={(v) => maj(i, { corps: v })} lignes={10} />
          <details>
            <summary className="discret">Aperçu avec un exemple</summary>
            <pre className="apercu">
              {remplir(e.sujet, exempleFacture, exempleClient, props.d.entreprise)}
              {"\n\n"}
              {remplir(e.corps, exempleFacture, exempleClient, props.d.entreprise)}
            </pre>
          </details>
        </Carte>
      ))}
      {erreur && <p className="erreur">{erreur}</p>}
      {info && <p className="info">{info}</p>}
      <div className="rangee">
        <button className="bouton" onClick={enregistrer}>
          Enregistrer
        </button>
        <button
          className="bouton bouton--secondaire"
          onClick={() =>
            setEtapes((l) => [
              ...l,
              { jours: (l.length ? Math.max(...l.map((x) => x.jours)) : 0) + 10, sujet: "Relance : facture {numero}", corps: ETAPES_PAR_DEFAUT[1].corps },
            ])
          }
        >
          + Ajouter une relance
        </button>
        <button
          className="bouton bouton--texte"
          onClick={() => confirm("Revenir aux 3 mails proposés par défaut ?") && setEtapes(ETAPES_PAR_DEFAUT.map((x) => ({ ...x })))}
        >
          Revenir aux mails par défaut
        </button>
      </div>
    </div>
  );
}
