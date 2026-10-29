import { useState } from "react";
import { enregistrerEntreprise, type Donnees } from "../donnees";
import { emailValide } from "../format";
import { Carte, Champ, Zone } from "./ui";

export function MonEntreprise(props: { d: Donnees; recharger: () => Promise<void>; onEnregistre: () => void }) {
  const [e, setE] = useState(props.d.entreprise);
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const maj = (champs: Partial<typeof e>) => {
    setInfo("");
    setE({ ...e, ...champs });
  };

  async function enregistrer() {
    setErreur("");
    if (!e.nom.trim()) return setErreur("Indiquez le nom de votre entreprise.");
    if (e.email && !emailValide(e.email)) return setErreur("Email invalide.");
    if (e.lien_paiement && !/^https:\/\//.test(e.lien_paiement.trim())) return setErreur("Le lien de paiement doit commencer par https://");
    try {
      await enregistrerEntreprise({ ...e, nom: e.nom.trim(), email: e.email.trim(), iban: e.iban.trim().toUpperCase() });
      await props.recharger();
      setInfo("Enregistré.");
      props.onEnregistre();
    } catch {
      setErreur("Enregistrement impossible, réessayez.");
    }
  }

  return (
    <div className="pile">
      {!props.d.entreprise.nom && (
        <p className="intro">Bienvenue ! Quelques informations pour signer vos relances, puis ajoutez vos factures à encaisser.</p>
      )}
      <Carte titre="Mon entreprise" sousTitre="Ces informations apparaissent dans vos mails de relance.">
        <div className="grille">
          <Champ label="Nom de l'entreprise" requis value={e.nom} onChange={(v) => maj({ nom: v })} />
          <Champ label="Email" type="email" value={e.email} onChange={(v) => maj({ email: v })} />
          <Champ label="Téléphone" value={e.telephone} onChange={(v) => maj({ telephone: v })} />
        </div>
        <Zone
          label="Signature des mails (facultatif)"
          value={e.signature}
          onChange={(v) => maj({ signature: v })}
          placeholder={"Par défaut : nom, téléphone et email ci-dessus.\nEx. : Marie Martin\nService comptabilité – Martin Rénovation\n06 12 34 56 78"}
          lignes={4}
        />
      </Carte>
      <Carte titre="Comment vos clients vous paient" sousTitre="Ajouté automatiquement dans les relances. Plus c'est simple de payer, plus vite vous êtes payé.">
        <div className="grille">
          <Champ label="IBAN" value={e.iban} onChange={(v) => maj({ iban: v })} placeholder="FR76 …" />
          <Champ
            label="Lien de paiement (facultatif)"
            value={e.lien_paiement}
            onChange={(v) => maj({ lien_paiement: v })}
            placeholder="https://…"
            aide="Lien Stripe, SumUp, PayPal… si vous en avez un"
          />
        </div>
      </Carte>
      {erreur && <p className="erreur">{erreur}</p>}
      {info && <p className="info">{info}</p>}
      <div className="rangee">
        <button className="bouton" onClick={enregistrer}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}
