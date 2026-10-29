import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOM_APP } from "../marque";
import { CLE_TURNSTILE } from "../supabase";
import { BoutonTheme } from "./Theme";
import { Turnstile } from "./Turnstile";
import { Champ } from "./ui";

const MESSAGES: [RegExp, string][] = [
  [/Invalid login credentials/i, "Email ou mot de passe incorrect."],
  [/Email not confirmed/i, "Votre email n'est pas encore confirmé. Ouvrez le lien reçu par email."],
  [/already registered/i, "Un compte existe déjà avec cet email. Connectez-vous."],
  [/Password should be/i, "Le mot de passe est trop court."],
  [/Signups not allowed/i, "Les inscriptions sont fermées pour le moment."],
  [/rate limit|too many|security purposes/i, "Trop de tentatives. Patientez une minute avant de réessayer."],
  [/invalid.*email|Unable to validate email/i, "Cette adresse email n'est pas valide."],
  [/captcha/i, "La vérification anti-robot a échoué. Réessayez."],
];

const traduire = (m: string) => MESSAGES.find(([r]) => r.test(m))?.[1] ?? m;

/** Adresse où revient la personne après avoir cliqué sur le lien de l'email. */
const retour = () => `${window.location.origin}/`;

type Mode = "connexion" | "inscription" | "oubli";

export function Connexion(props: { supabase: Pick<SupabaseClient, "auth"> }) {
  const [mode, setMode] = useState<Mode>("connexion");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState("");
  const [info, setInfo] = useState("");
  const [renvoyer, setRenvoyer] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [jeton, setJeton] = useState<string | null>(null);
  const [versionCaptcha, setVersionCaptcha] = useState(0);
  const auth = props.supabase.auth;
  const captcha = CLE_TURNSTILE ? { captchaToken: jeton ?? undefined } : {};
  /** Un jeton anti-robot ne sert qu'une fois : on en redemande un après chaque envoi. */
  const nouveauCaptcha = () => CLE_TURNSTILE && setVersionCaptcha((v) => v + 1);

  function changerMode(m: Mode) {
    setMode(m);
    setErreur("");
    setInfo("");
    setRenvoyer(false);
  }

  async function valider(e: FormEvent) {
    e.preventDefault();
    setErreur("");
    setInfo("");
    setRenvoyer(false);
    const adresse = email.trim();
    if (!adresse) return setErreur("Renseignez votre email.");
    if (mode !== "oubli" && !motDePasse) return setErreur("Renseignez votre mot de passe.");
    if (CLE_TURNSTILE && !jeton) return setErreur("Patientez un instant : la vérification anti-robot n'est pas terminée.");
    if (mode === "inscription") {
      if (motDePasse.length < 8) return setErreur("Choisissez un mot de passe d'au moins 8 caractères.");
      if (motDePasse !== confirmation) return setErreur("Les deux mots de passe ne correspondent pas.");
    }
    setEnCours(true);
    try {
      if (mode === "connexion") {
        const { error } = await auth.signInWithPassword({ email: adresse, password: motDePasse, options: captcha });
        if (error) {
          setErreur(traduire(error.message));
          if (/not confirmed/i.test(error.message)) setRenvoyer(true);
        }
      } else if (mode === "inscription") {
        const { data, error } = await auth.signUp({
          email: adresse,
          password: motDePasse,
          // « app » : le serveur est partagé avec d'autres apps, chacune reconnaît ses comptes
          options: { emailRedirectTo: retour(), data: { app: "relance" }, ...captcha },
        });
        if (error) setErreur(traduire(error.message));
        else if (!data.session) {
          setInfo(`Un email vient d'être envoyé à ${adresse}. Cliquez sur le lien qu'il contient pour activer votre compte (pensez aux indésirables).`);
          setRenvoyer(true);
        }
      } else {
        const { error } = await auth.resetPasswordForEmail(adresse, { redirectTo: retour(), ...captcha });
        if (error) setErreur(traduire(error.message));
        else setInfo(`Si un compte existe pour ${adresse}, un lien pour choisir un nouveau mot de passe vient d'être envoyé.`);
      }
    } catch {
      setErreur("Impossible de joindre le serveur. Vérifiez votre connexion internet.");
    } finally {
      setEnCours(false);
      nouveauCaptcha();
    }
  }

  async function renvoyerEmail() {
    setErreur("");
    const { error } = await auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: retour(), ...captcha },
    });
    nouveauCaptcha();
    if (error) setErreur(traduire(error.message));
    else setInfo("Email renvoyé. Pensez à regarder dans les indésirables.");
  }

  const titres: Record<Mode, string> = {
    connexion: "Connexion",
    inscription: "Créer mon compte",
    oubli: "Mot de passe oublié",
  };

  return (
    <div className="connexion">
      <BoutonTheme className="connexion__theme" />
      <div className="marque marque--centre">
        <span className="marque__logo" aria-hidden>
          R
        </span>
        <span>{NOM_APP}</span>
      </div>
      <form className="carte connexion__carte" onSubmit={valider} noValidate>
        <h2>{titres[mode]}</h2>
        <p className="discret">
          {mode === "connexion"
            ? "Retrouvez vos factures à encaisser et vos relances sur tous vos appareils."
            : mode === "inscription"
              ? "Gratuit pour commencer. Vos relances partent de votre propre boîte mail."
              : "Indiquez votre email : vous recevrez un lien pour choisir un nouveau mot de passe."}
        </p>
        <Champ label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />
        {mode !== "oubli" && (
          <Champ
            label="Mot de passe"
            type="password"
            value={motDePasse}
            onChange={setMotDePasse}
            autoComplete={mode === "connexion" ? "current-password" : "new-password"}
          />
        )}
        {mode === "inscription" && (
          <Champ
            label="Confirmer le mot de passe"
            type="password"
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
          />
        )}
        {CLE_TURNSTILE && <Turnstile cleSite={CLE_TURNSTILE} version={versionCaptcha} onJeton={setJeton} />}
        {erreur && <p className="erreur">{erreur}</p>}
        {info && <p className="info">{info}</p>}
        <button className="bouton" type="submit" disabled={enCours}>
          {enCours
            ? "Un instant…"
            : mode === "connexion"
              ? "Se connecter"
              : mode === "inscription"
                ? "Créer mon compte"
                : "Recevoir le lien"}
        </button>
        {renvoyer && (
          <button type="button" className="bouton bouton--texte" onClick={renvoyerEmail}>
            Renvoyer l'email d'activation
          </button>
        )}
        {mode === "connexion" && (
          <button type="button" className="bouton bouton--texte" onClick={() => changerMode("oubli")}>
            Mot de passe oublié ?
          </button>
        )}
        <button
          type="button"
          className="bouton bouton--texte"
          onClick={() => changerMode(mode === "connexion" ? "inscription" : "connexion")}
        >
          {mode === "connexion" ? "Pas encore de compte ? Créer un compte" : "J'ai déjà un compte"}
        </button>
      </form>
    </div>
  );
}

/** Après le lien « mot de passe oublié » : choisir le nouveau mot de passe. */
export function NouveauMotDePasse(props: { supabase: Pick<SupabaseClient, "auth">; onFini: () => void }) {
  const [mdp, setMdp] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState("");
  const [enCours, setEnCours] = useState(false);

  async function valider(e: FormEvent) {
    e.preventDefault();
    setErreur("");
    if (mdp.length < 8) return setErreur("Choisissez un mot de passe d'au moins 8 caractères.");
    if (mdp !== confirmation) return setErreur("Les deux mots de passe ne correspondent pas.");
    setEnCours(true);
    const { error } = await props.supabase.auth.updateUser({ password: mdp });
    setEnCours(false);
    if (error) setErreur(traduire(error.message));
    else props.onFini();
  }

  return (
    <div className="connexion">
      <BoutonTheme className="connexion__theme" />
      <form className="carte connexion__carte" onSubmit={valider} noValidate>
        <h2>Nouveau mot de passe</h2>
        <Champ label="Nouveau mot de passe" type="password" value={mdp} onChange={setMdp} autoComplete="new-password" />
        <Champ
          label="Confirmer le mot de passe"
          type="password"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
        />
        {erreur && <p className="erreur">{erreur}</p>}
        <button className="bouton" type="submit" disabled={enCours}>
          {enCours ? "Un instant…" : "Enregistrer"}
        </button>
      </form>
    </div>
  );
}
