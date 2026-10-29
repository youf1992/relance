import { useState } from "react";
import { annulerRelance, changerStatut, majClient, majFacture, noterRelance, type Donnees } from "../donnees";
import { aujourdhui, dateFr, ecartJours, emailValide, euros } from "../format";
import { aRelancer, bloquees, enCours, lienMail, remplir, type ARelancer } from "../relances";
import type { Relance } from "../types";
import { Carte } from "./ui";

type Onglet = "aujourdhui" | "factures" | "clients" | "modeles" | "entreprise";

export function Aujourdhui(props: { d: Donnees; recharger: () => Promise<void>; aller: (o: Onglet) => void }) {
  const { d, recharger } = props;
  const jour = aujourdhui();
  const liste = aRelancer(d.factures, d.clients, d.etapes, d.relances, jour);
  const aTraiter = bloquees(d.factures, d.etapes, d.relances, jour);
  const [envoyees, setEnvoyees] = useState<{ relance: Relance; libelle: string }[]>([]);
  const [erreur, setErreur] = useState("");

  const ouvertes = d.factures.filter(enCours);
  const ouvertesTout = d.factures.filter((f) => f.statut === "a_payer");
  const aEncaisser = ouvertesTout.reduce((s, f) => s + f.montant, 0);
  const enRetard = ouvertesTout.filter((f) => f.echeance < jour).reduce((s, f) => s + f.montant, 0);
  const mois = jour.slice(0, 7);
  const encaisse = d.factures
    .filter((f) => f.statut === "payee" && f.payee_le?.startsWith(mois))
    .reduce((s, f) => s + f.montant, 0);
  const relancesMois = d.relances.filter((r) => r.envoyee_le.startsWith(mois)).length;
  const ordre = [...d.etapes].sort((a, b) => a.jours - b.jours);
  const libelleEtape = (jours: number) => {
    const i = ordre.findIndex((e) => e.jours === jours);
    return `Relance ${i + 1}/${ordre.length} (J+${jours})`;
  };
  const client = (id: string) => d.clients.find((c) => c.id === id);

  async function agir(action: () => Promise<unknown>) {
    setErreur("");
    try {
      await action();
      await recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur, réessayez.");
    }
  }

  async function envoyer(x: ARelancer) {
    const sujet = remplir(x.etape.sujet, x.facture, x.client, d.entreprise, jour);
    const corps = remplir(x.etape.corps, x.facture, x.client, d.entreprise, jour);
    const a = document.createElement("a");
    a.href = lienMail(x.client?.email ?? "", sujet, corps);
    a.click();
    await agir(async () => {
      const r = await noterRelance(x.facture.id, x.etape.jours);
      setEnvoyees((l) => [{ relance: r, libelle: `${x.client?.nom ?? ""} · ${x.facture.numero}` }, ...l]);
    });
  }

  return (
    <div className="pile">
      <div className="chiffres">
        <div className="chiffre">
          <span>À encaisser</span>
          <strong>{euros(aEncaisser)}</strong>
          <small>{ouvertesTout.length} facture{ouvertesTout.length > 1 ? "s" : ""}</small>
        </div>
        <div className="chiffre chiffre--attention">
          <span>En retard</span>
          <strong>{euros(enRetard)}</strong>
          <small>{ouvertes.filter((f) => f.echeance < jour).length} en retard</small>
        </div>
        <div className="chiffre chiffre--ok">
          <span>Encaissé ce mois</span>
          <strong>{euros(encaisse)}</strong>
          <small>{relancesMois} relance{relancesMois > 1 ? "s" : ""} ce mois</small>
        </div>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}

      {envoyees.length > 0 && (
        <div className="info">
          {envoyees.map((e) => (
            <div key={e.relance.id} className="rangee rangee--entre">
              <span>Relance notée : {e.libelle}</span>
              <button
                className="bouton bouton--texte bouton--petit"
                onClick={() =>
                  agir(async () => {
                    await annulerRelance(e.relance.id);
                    setEnvoyees((l) => l.filter((x) => x.relance.id !== e.relance.id));
                  })
                }
              >
                Pas envoyée ? Annuler
              </button>
            </div>
          ))}
        </div>
      )}

      <Carte
        titre={liste.length ? `${liste.length} relance${liste.length > 1 ? "s" : ""} à envoyer aujourd'hui` : "Rien à relancer aujourd'hui"}
        sousTitre={
          liste.length
            ? "« Ouvrir le mail » prépare le message dans votre messagerie : vérifiez-le puis envoyez."
            : d.factures.length
              ? "Les relances apparaîtront ici automatiquement, le jour venu."
              : "Ajoutez vos factures à encaisser : l'app vous dira chaque jour qui relancer."
        }
      >
        {!d.factures.length && (
          <button className="bouton" onClick={() => props.aller("factures")}>
            Ajouter mes factures
          </button>
        )}
        <div className="pile pile--serree">
          {liste.map((x) => (
            <LigneRelance
              key={x.facture.id}
              x={x}
              libelle={libelleEtape(x.etape.jours)}
              apercu={remplir(x.etape.corps, x.facture, x.client, d.entreprise, jour)}
              onEnvoyer={() => envoyer(x)}
              onPayee={() => agir(() => changerStatut(x.facture.id, "payee", jour))}
              onPause={() => agir(() => majFacture(x.facture.id, { pause: true }))}
              onEmail={(email) => agir(() => majClient({ ...x.client!, email }))}
            />
          ))}
        </div>
      </Carte>

      {aTraiter.length > 0 && (
        <Carte
          titre="À traiter vous-même"
          sousTitre="Toutes les relances sont parties et ce n'est toujours pas payé : un appel, une mise en demeure, ou un litige à noter."
        >
          <ul className="liste">
            {aTraiter.map((f) => (
              <li key={f.id}>
                <div className="rangee rangee--entre">
                  <span>
                    <strong>{client(f.client_id)?.nom}</strong> · {f.numero} · {euros(f.montant)} ·{" "}
                    {ecartJours(jour, f.echeance)} jours de retard
                    {client(f.client_id)?.telephone && <> · {client(f.client_id)?.telephone}</>}
                  </span>
                  <span className="rangee">
                    <button className="bouton bouton--petit" onClick={() => agir(() => changerStatut(f.id, "payee", jour))}>
                      Payée
                    </button>
                    <button
                      className="bouton bouton--secondaire bouton--petit"
                      onClick={() => agir(() => changerStatut(f.id, "litige"))}
                    >
                      Litige
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Carte>
      )}

      {ouvertes.length > 0 && (
        <p className="discret petit">
          Prochaines échéances :{" "}
          {ouvertes
            .filter((f) => f.echeance >= jour)
            .slice(0, 5)
            .map((f) => `${client(f.client_id)?.nom ?? "?"} ${euros(f.montant)} le ${dateFr(f.echeance)}`)
            .join(" · ") || "aucune"}
        </p>
      )}
    </div>
  );
}

function LigneRelance(props: {
  x: ARelancer;
  libelle: string;
  apercu: string;
  onEnvoyer: () => void;
  onPayee: () => void;
  onPause: () => void;
  onEmail: (email: string) => void;
}) {
  const { x } = props;
  const [voir, setVoir] = useState(false);
  const [email, setEmail] = useState("");
  const sansEmail = !x.client?.email;
  return (
    <div className="relance">
      <div className="rangee rangee--entre">
        <div>
          <strong>{x.client?.nom ?? "Client inconnu"}</strong>
          <span className="discret">
            {" "}
            · facture {x.facture.numero} · {euros(x.facture.montant)}
          </span>
          <div className="petit">
            <span className="badge badge--attention">{x.retard} j de retard</span> <span className="discret">{props.libelle}</span>
          </div>
        </div>
        <div className="rangee">
          {!sansEmail && (
            <button className="bouton" onClick={props.onEnvoyer}>
              Ouvrir le mail
            </button>
          )}
          <button className="bouton bouton--secondaire" onClick={props.onPayee}>
            Payée
          </button>
          <button className="bouton bouton--texte" onClick={props.onPause} title="Ne plus relancer cette facture">
            Pause
          </button>
        </div>
      </div>
      {sansEmail && (
        <div className="rangee">
          <input
            type="email"
            placeholder="Email du client pour le relancer"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="bouton bouton--secondaire" disabled={!emailValide(email)} onClick={() => props.onEmail(email.trim())}>
            Enregistrer
          </button>
        </div>
      )}
      <button className="bouton bouton--texte bouton--petit" onClick={() => setVoir(!voir)}>
        {voir ? "Masquer le message" : "Voir le message"}
      </button>
      {voir && <pre className="apercu">{props.apercu}</pre>}
    </div>
  );
}
