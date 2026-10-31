// Écran réservé à l'administrateur : limite de plans lus par IA, par défaut et par client.
// La vérification « est-ce bien l'administrateur ? » est faite par la base, à chaque action.
import { useCallback, useEffect, useState } from "react";
import { dateFr } from "../format";
import { supabase } from "../supabase";
import { Carte } from "./ui";

interface ClientAdmin {
  id: string;
  nom: string;
  email: string;
  inscrit_le: string;
  plans_mois: number;
  limite: number | null;
  devis: number;
}

interface VueAdmin {
  defaut: number;
  clients: ClientAdmin[];
}

const MESSAGES: Record<string, string> = {
  interdit: "Action réservée à l'administrateur.",
  limite_invalide: "Limite invalide (entre 0 et 100 000).",
};

function message(e: { message: string } | null | undefined) {
  if (!e) return "";
  const cle = Object.keys(MESSAGES).find((k) => e.message.includes(k));
  if (cle) return MESSAGES[cle];
  if (/does not exist|Could not find/i.test(e.message)) return "Relancez le script d'installation de Relance sur le VPS.";
  return e.message;
}

/** Entier positif, ou null si vide ; NaN si illisible. */
const lireLimite = (s: string) => (s.trim() === "" ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

export function Admin() {
  const [vue, setVue] = useState<VueAdmin | null>(null);
  const [erreur, setErreur] = useState("");
  const [ok, setOk] = useState("");
  const [defaut, setDefaut] = useState("");
  const [saisies, setSaisies] = useState<Record<string, string>>({});
  const [filtre, setFiltre] = useState("");

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc("admin_vue");
    if (error) return setErreur(message(error));
    const v = data as VueAdmin;
    setVue(v);
    setDefaut(String(v.defaut));
    setSaisies(Object.fromEntries(v.clients.map((c) => [c.id, c.limite === null ? "" : String(c.limite)])));
  }, []);

  useEffect(() => {
    charger().then(() => {});
  }, [charger]);

  async function agir(appel: PromiseLike<{ error: { message: string } | null }>, texte: string) {
    setErreur("");
    setOk("");
    const { error } = await appel;
    if (error) return setErreur(message(error));
    setOk(texte);
    await charger();
  }

  if (!vue) return erreur ? <p className="erreur">{erreur}</p> : <p className="discret">Chargement…</p>;

  const total = vue.clients.reduce((s, c) => s + c.plans_mois, 0);
  const visibles = vue.clients.filter((c) =>
    `${c.nom} ${c.email}`.toLowerCase().includes(filtre.trim().toLowerCase()),
  );

  return (
    <div className="pile">
      <div className="chiffres">
        <div className="chiffre">
          <span>Clients</span>
          <strong>{vue.clients.length}</strong>
          <small>comptes Relance</small>
        </div>
        <div className="chiffre">
          <span>Plans lus ce mois-ci</span>
          <strong>{total}</strong>
          <small>tous clients confondus</small>
        </div>
        <div className="chiffre">
          <span>Limite par défaut</span>
          <strong>{vue.defaut}</strong>
          <small>plans par client et par mois</small>
        </div>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}
      {ok && <p className="succes">{ok}</p>}

      <Carte
        titre="Limite par défaut"
        sousTitre="Nombre de plans qu'un client peut faire lire par l'IA chaque mois. S'applique à tous les clients sans limite personnelle."
      >
        <div className="rangee">
          <input
            aria-label="Limite par défaut"
            inputMode="numeric"
            className="champ-court"
            value={defaut}
            onChange={(e) => setDefaut(e.target.value)}
          />
          <span className="discret">plans / mois</span>
          <button
            className="bouton"
            onClick={() => {
              const n = lireLimite(defaut);
              if (n === null || Number.isNaN(n)) return setErreur("Indiquez un nombre entier.");
              agir(supabase.rpc("admin_limite_defaut", { p_limite: n }), `Limite par défaut : ${n} plans par mois.`);
            }}
          >
            Enregistrer
          </button>
        </div>
      </Carte>

      <Carte
        titre="Clients"
        sousTitre="Limite personnelle : laissez vide pour la limite par défaut, mettez 0 pour bloquer la lecture de plans."
        actions={
          <input
            aria-label="Rechercher un client"
            placeholder="Rechercher…"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
          />
        }
      >
        {visibles.length === 0 ? (
          <p className="discret">Aucun client.</p>
        ) : (
          <ul className="liste">
            {visibles.map((c) => {
              const limite = c.limite ?? vue.defaut;
              const plein = c.plans_mois >= limite;
              return (
                <li key={c.id}>
                  <div className="rangee rangee--entre">
                    <div>
                      <strong>{c.nom || "(entreprise sans nom)"}</strong> <span className="discret">· {c.email}</span>
                      <div className="petit discret">
                        Inscrit le {dateFr(c.inscrit_le)} · {c.devis} devis ·{" "}
                        <span className={plein ? "attention" : ""}>
                          {c.plans_mois} / {limite} plans ce mois-ci
                        </span>
                        {c.limite !== null && " (limite personnelle)"}
                      </div>
                    </div>
                    <div className="rangee">
                      <input
                        aria-label={`Limite de ${c.nom || c.email}`}
                        inputMode="numeric"
                        className="champ-court"
                        placeholder={`défaut (${vue.defaut})`}
                        value={saisies[c.id] ?? ""}
                        onChange={(e) => setSaisies({ ...saisies, [c.id]: e.target.value })}
                      />
                      <button
                        className="bouton bouton--secondaire bouton--petit"
                        onClick={() => {
                          const n = lireLimite(saisies[c.id] ?? "");
                          if (Number.isNaN(n)) return setErreur("Indiquez un nombre entier, ou laissez vide.");
                          agir(
                            supabase.rpc("admin_limite_client", { p_entreprise: c.id, p_limite: n }),
                            n === null
                              ? `${c.nom || c.email} : limite par défaut.`
                              : `${c.nom || c.email} : ${n} plans par mois.`,
                          );
                        }}
                      >
                        Enregistrer
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Carte>
    </div>
  );
}
