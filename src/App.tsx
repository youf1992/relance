import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Aujourdhui } from "./components/Aujourdhui";
import { Clients } from "./components/Clients";
import { Connexion, NouveauMotDePasse } from "./components/Connexion";
import { MonEntreprise } from "./components/MonEntreprise";
import { Factures } from "./components/Factures";
import { Modeles } from "./components/Modeles";
import { Banque } from "./components/Banque";
import { Chargement } from "./components/Chargement";
import { Depenses, type DepenseDepuisBanque } from "./components/Depenses";
import { Devis } from "./components/Devis";
import { BoutonTheme } from "./components/Theme";
import { charger, type Donnees } from "./donnees";
import { NOM_APP } from "./marque";
import { piecesManquantes } from "./precompta";
import { aRelancer } from "./relances";
import { supabase } from "./supabase";

type Onglet = "aujourdhui" | "devis" | "factures" | "clients" | "depenses" | "banque" | "modeles" | "entreprise";

export default function App() {
  // undefined = on ne sait pas encore ; null = pas connecté
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recuperation, setRecuperation] = useState(false);
  const [donnees, setDonnees] = useState<Donnees | null>(null);
  const [erreur, setErreur] = useState("");
  const [onglet, setOnglet] = useState<Onglet>("aujourdhui");
  const [depuisBanque, setDepuisBanque] = useState<DepenseDepuisBanque | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((evenement, s) => {
      if (evenement === "PASSWORD_RECOVERY") setRecuperation(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const email = session?.user.email ?? "";

  const recharger = useCallback(async () => {
    if (!uid) return;
    try {
      setDonnees(await charger(uid, email));
      setErreur("");
    } catch {
      setErreur("Impossible de charger vos données. Vérifiez votre connexion internet.");
    }
  }, [uid, email]);

  useEffect(() => {
    setDonnees(null);
    if (!uid) return;
    recharger().then(() => {});
  }, [uid, recharger]);

  // Premier passage : on commence par « Mon entreprise » si le nom n'est pas renseigné
  const nomManquant = !!donnees && !donnees.entreprise.nom.trim();
  useEffect(() => {
    if (nomManquant) setOnglet("entreprise");
  }, [nomManquant]);

  if (recuperation && session) return <NouveauMotDePasse supabase={supabase} onFini={() => setRecuperation(false)} />;
  if (session === null) return <Connexion supabase={supabase} />;
  if (erreur)
    return (
      <div className="vide">
        <h2>Oups</h2>
        <p>{erreur}</p>
        <button className="bouton" onClick={() => window.location.reload()}>
          Réessayer
        </button>
      </div>
    );
  if (!donnees) return <Chargement />;

  const nbManquantes = piecesManquantes(donnees.banque).length;
  const nbAujourdhui = aRelancer(donnees.factures, donnees.clients, donnees.etapes, donnees.relances).length;
  const onglets: { id: Onglet; titre: string }[] = [
    { id: "aujourdhui", titre: nbAujourdhui ? `Aujourd'hui (${nbAujourdhui})` : "Aujourd'hui" },
    { id: "devis", titre: "Devis" },
    { id: "factures", titre: "Factures" },
    { id: "clients", titre: "Clients" },
    { id: "depenses", titre: "Dépenses" },
    { id: "banque", titre: nbManquantes ? `Banque (${nbManquantes})` : "Banque" },
    { id: "modeles", titre: "Mails de relance" },
    { id: "entreprise", titre: "Mon entreprise" },
  ];

  return (
    <div className="app">
      <header className="entete">
        <div className="entete__interieur">
          <div className="entete__haut">
            <div className="marque">
              <span className="marque__logo" aria-hidden>
                R
              </span>
              <span>
                {NOM_APP}
                {donnees.entreprise.nom && <small>{donnees.entreprise.nom}</small>}
              </span>
            </div>
            <div className="entete__actions">
              <BoutonTheme />
              <button className="bouton bouton--texte" onClick={() => supabase.auth.signOut()}>
                Se déconnecter
              </button>
            </div>
          </div>
          <nav className="onglets">
            {onglets.map((o) => (
              <button
                key={o.id}
                className={`onglet${onglet === o.id ? " onglet--actif" : ""}`}
                onClick={() => setOnglet(o.id)}
              >
                {o.titre}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="contenu">
        {onglet === "aujourdhui" && <Aujourdhui d={donnees} recharger={recharger} aller={setOnglet} />}
        {onglet === "devis" && <Devis d={donnees} uid={uid!} recharger={recharger} />}
        {onglet === "factures" && <Factures d={donnees} recharger={recharger} />}
        {onglet === "clients" && <Clients d={donnees} recharger={recharger} />}
        {onglet === "depenses" && (
          <Depenses
            d={donnees}
            uid={uid!}
            recharger={recharger}
            depuisBanque={depuisBanque}
            finDepuisBanque={() => {
              if (depuisBanque) setOnglet("banque");
              setDepuisBanque(null);
            }}
          />
        )}
        {onglet === "banque" && (
          <Banque
            d={donnees}
            recharger={recharger}
            ajouterJustificatif={(x) => {
              setDepuisBanque(x);
              setOnglet("depenses");
            }}
          />
        )}
        {onglet === "modeles" && <Modeles d={donnees} uid={uid!} recharger={recharger} />}
        {onglet === "entreprise" && (
          <MonEntreprise
            d={donnees}
            recharger={recharger}
            onEnregistre={() => nomManquant && setOnglet("factures")}
          />
        )}
      </main>

      <footer className="pied">Vos relances partent de votre propre boîte mail : vos clients reconnaissent votre adresse.</footer>
    </div>
  );
}
