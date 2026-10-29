import { useState } from "react";
import { majClient, supprimerClient, type Donnees } from "../donnees";
import { aujourdhui, emailValide, euros } from "../format";
import type { Client } from "../types";
import { Carte, Champ, Zone } from "./ui";

export function Clients(props: { d: Donnees; recharger: () => Promise<void> }) {
  const { d } = props;
  const jour = aujourdhui();
  const [edition, setEdition] = useState<string | null>(null);
  const du = (c: Client) =>
    d.factures.filter((f) => f.client_id === c.id && f.statut === "a_payer").reduce((s, f) => s + f.montant, 0);
  const retard = (c: Client) =>
    d.factures
      .filter((f) => f.client_id === c.id && f.statut === "a_payer" && f.echeance < jour)
      .reduce((s, f) => s + f.montant, 0);
  const tries = [...d.clients].sort((a, b) => du(b) - du(a) || a.nom.localeCompare(b.nom));

  return (
    <Carte titre={`${d.clients.length} client${d.clients.length > 1 ? "s" : ""}`} sousTitre="Ajoutés automatiquement avec leurs factures.">
      {tries.length === 0 ? (
        <p className="discret">Aucun client pour l'instant.</p>
      ) : (
        <ul className="liste">
          {tries.map((c) => (
            <li key={c.id}>
              {edition === c.id ? (
                <EditionClient
                  c={c}
                  aDesFactures={d.factures.some((f) => f.client_id === c.id)}
                  onFini={async () => {
                    setEdition(null);
                    await props.recharger();
                  }}
                />
              ) : (
                <div className="rangee rangee--entre">
                  <div>
                    <strong>{c.nom}</strong>
                    <div className="petit discret">
                      {c.email || <span className="erreur-texte">pas d'email : impossible de relancer</span>}
                      {c.telephone && ` · ${c.telephone}`}
                    </div>
                  </div>
                  <div className="rangee">
                    {du(c) > 0 && (
                      <span className={retard(c) > 0 ? "badge badge--attention" : "badge"}>
                        doit {euros(du(c))}
                        {retard(c) > 0 && ` (dont ${euros(retard(c))} en retard)`}
                      </span>
                    )}
                    <button className="bouton bouton--texte bouton--petit" onClick={() => setEdition(c.id)}>
                      Modifier
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Carte>
  );
}

function EditionClient(props: { c: Client; aDesFactures: boolean; onFini: () => Promise<void> }) {
  const [c, setC] = useState(props.c);
  const [erreur, setErreur] = useState("");
  async function enregistrer() {
    if (!c.nom.trim()) return setErreur("Le nom est obligatoire.");
    if (c.email && !emailValide(c.email)) return setErreur("Email invalide.");
    try {
      await majClient({ ...c, nom: c.nom.trim(), email: c.email.trim() });
      await props.onFini();
    } catch (e) {
      setErreur(e instanceof Error && /duplicate|unique/i.test(e.message) ? "Un autre client porte déjà ce nom." : "Enregistrement impossible.");
    }
  }
  async function supprimer() {
    if (!confirm(`Supprimer ${c.nom} ?`)) return;
    try {
      await supprimerClient(c.id);
      await props.onFini();
    } catch {
      setErreur("Impossible : ce client a encore des factures.");
    }
  }
  return (
    <div className="pile pile--serree">
      <div className="grille">
        <Champ label="Nom" requis value={c.nom} onChange={(v) => setC({ ...c, nom: v })} />
        <Champ label="Email (pour les relances)" type="email" value={c.email} onChange={(v) => setC({ ...c, email: v })} />
        <Champ label="Téléphone" value={c.telephone} onChange={(v) => setC({ ...c, telephone: v })} />
      </div>
      <Zone label="Notes" value={c.notes} onChange={(v) => setC({ ...c, notes: v })} lignes={2} />
      {erreur && <p className="erreur">{erreur}</p>}
      <div className="rangee">
        <button className="bouton" onClick={enregistrer}>
          Enregistrer
        </button>
        <button className="bouton bouton--texte" onClick={() => props.onFini()}>
          Annuler
        </button>
        {!props.aDesFactures && (
          <button className="bouton bouton--texte" onClick={supprimer}>
            Supprimer
          </button>
        )}
      </div>
    </div>
  );
}
