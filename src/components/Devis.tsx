import { useCallback, useEffect, useState } from "react";
import {
  CATEGORIES_ARTICLE,
  DIFFICULTES,
  LIBELLE_UNITE,
  chiffrer,
  nouvelId,
  pieceVide,
  prochainNumero,
  type Article,
  type Categorie,
  type Fourniture,
  type Piece,
  type Reglages,
  type Unite,
} from "../devis";
import { ajouterClient, type Donnees } from "../donnees";
import {
  chargerDevis,
  enregistrerArticle,
  enregistrerDevis,
  enregistrerReglages,
  facturerDevis,
  lirePlan,
  majDevis,
  supprimerArticle,
  supprimerDevis,
  type Devis as UnDevis,
  type DonneesDevis,
  type PlanLu,
  type StatutDevis,
} from "../donneesDevis";
import { htmlDevis, imprimerDevis } from "../devisPdf";
import { aujourdhui, dateFr, euros, lireMontant } from "../format";
import { Carte, Champ, Zone } from "./ui";

type Vue = "liste" | "catalogue" | "reglages";

const STATUTS: { id: StatutDevis; libelle: string; badge: string }[] = [
  { id: "brouillon", libelle: "Brouillon", badge: "" },
  { id: "envoye", libelle: "Envoyé", badge: "badge--attention" },
  { id: "accepte", libelle: "Accepté", badge: "badge--ok" },
  { id: "refuse", libelle: "Refusé", badge: "badge--danger" },
];

const nb = (s: string) => lireMontant(s) ?? 0;
const txt = (n: number) => (n ? String(n).replace(".", ",") : "");
const heures = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

export function Devis(props: { d: Donnees; uid: string; recharger: () => Promise<void> }) {
  const [dd, setDd] = useState<DonneesDevis | null>(null);
  const [erreur, setErreur] = useState("");
  const [vue, setVue] = useState<Vue>("liste");
  const [edition, setEdition] = useState<UnDevis | "nouveau" | null>(null);

  const recharger = useCallback(async () => {
    try {
      setDd(await chargerDevis(props.uid));
      setErreur("");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Chargement impossible.");
    }
  }, [props.uid]);

  useEffect(() => {
    recharger().then(() => {});
  }, [recharger]);

  if (erreur && !dd) return <p className="erreur">{erreur}</p>;
  if (!dd) return <p className="discret">Chargement des devis…</p>;
  if (!dd.installe)
    return (
      <Carte titre="Module Devis pas encore installé">
        <p>Les tables du module Devis n'existent pas encore sur le serveur. Relancez le script d'installation de Relance sur le VPS.</p>
      </Carte>
    );

  if (edition)
    return (
      <Editeur
        d={props.d}
        dd={dd}
        initial={edition === "nouveau" ? null : edition}
        rechargerTout={async () => {
          await props.recharger();
          await recharger();
        }}
        fermer={async () => {
          setEdition(null);
          await recharger();
        }}
      />
    );

  return (
    <div className="pile">
      <div className="rangee rangee--entre">
        <div className="pastilles" style={{ marginTop: 0 }}>
          {(
            [
              ["liste", "Mes devis"],
              ["catalogue", "Catalogue de prix"],
              ["reglages", "Temps et taux"],
            ] as [Vue, string][]
          ).map(([id, t]) => (
            <button key={id} className={`pastille${vue === id ? " pastille--active" : ""}`} onClick={() => setVue(id)}>
              {t}
            </button>
          ))}
        </div>
        {vue === "liste" && (
          <button className="bouton" onClick={() => setEdition("nouveau")}>
            + Nouveau devis
          </button>
        )}
      </div>
      {erreur && <p className="erreur">{erreur}</p>}
      {vue === "liste" && <ListeDevis d={props.d} dd={dd} ouvrir={setEdition} recharger={recharger} rechargerTout={props.recharger} />}
      {vue === "catalogue" && <Catalogue dd={dd} recharger={recharger} />}
      {vue === "reglages" && <ReglagesDevis uid={props.uid} dd={dd} recharger={recharger} />}
    </div>
  );
}

// --- Liste des devis ---------------------------------------------------------------------

function suivantFacture(numeros: string[]): string {
  const dernier = numeros.filter((n) => /\d+$/.test(n)).sort().pop();
  if (!dernier) return `F-${new Date().getFullYear()}-001`;
  return dernier.replace(/(\d+)$/, (m) => String(Number(m) + 1).padStart(m.length, "0"));
}

function ListeDevis(props: {
  d: Donnees;
  dd: DonneesDevis;
  ouvrir: (x: UnDevis) => void;
  recharger: () => Promise<void>;
  rechargerTout: () => Promise<void>;
}) {
  const { d, dd } = props;
  const [erreur, setErreur] = useState("");
  const nomClient = (id: string | null) => d.clients.find((c) => c.id === id)?.nom ?? "Client à choisir";
  const enAttente = dd.devis.filter((x) => x.statut === "envoye");
  const acceptes = dd.devis.filter((x) => x.statut === "accepte");
  const decides = dd.devis.filter((x) => x.statut === "accepte" || x.statut === "refuse").length;
  const comparables = dd.devis.filter((x) => x.heures_reelles && x.heures_prevues);
  const ecart = comparables.length
    ? comparables.reduce((s, x) => s + x.heures_reelles! / x.heures_prevues, 0) / comparables.length - 1
    : 0;

  async function agir(action: () => Promise<unknown>, toutRecharger = false) {
    setErreur("");
    try {
      await action();
      if (toutRecharger) await props.rechargerTout();
      await props.recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Erreur, réessayez.");
    }
  }

  return (
    <>
      <div className="chiffres">
        <div className="chiffre chiffre--attention">
          <span>Devis en attente</span>
          <strong>{euros(enAttente.reduce((s, x) => s + x.total_ttc, 0))}</strong>
          <small>{enAttente.length} envoyé(s), sans réponse</small>
        </div>
        <div className="chiffre chiffre--ok">
          <span>Devis acceptés</span>
          <strong>{euros(acceptes.reduce((s, x) => s + x.total_ttc, 0))}</strong>
          <small>{decides ? `${Math.round((acceptes.length / decides) * 100)} % de devis acceptés` : "aucune réponse pour l'instant"}</small>
        </div>
        <div className={`chiffre${Math.abs(ecart) > 0.1 ? " chiffre--attention" : ""}`}>
          <span>Temps réel / prévu</span>
          <strong>{comparables.length ? `${ecart >= 0 ? "+" : ""}${Math.round(ecart * 100)} %` : "–"}</strong>
          <small>
            {comparables.length
              ? ecart > 0.1
                ? "Vous passez plus de temps que prévu : augmentez vos temps standards."
                : ecart < -0.1
                  ? "Vous allez plus vite que prévu : vos devis peuvent baisser."
                  : `Vos temps sont justes (${comparables.length} chantier(s)).`
              : "Notez le temps réel de vos chantiers pour affiner."}
          </small>
        </div>
      </div>

      {erreur && <p className="erreur">{erreur}</p>}

      <Carte titre={`${dd.devis.length} devis`}>
        {dd.devis.length === 0 ? (
          <p className="discret">
            Aucun devis. Commencez par vérifier vos prix dans « Catalogue de prix » et vos temps dans « Temps et taux », puis
            créez un devis.
          </p>
        ) : (
          <ul className="liste">
            {dd.devis.map((x) => {
              const s = STATUTS.find((t) => t.id === x.statut)!;
              const facture = x.facture_id ? d.factures.find((f) => f.id === x.facture_id) : undefined;
              return (
                <li key={x.id}>
                  <div className="rangee rangee--entre">
                    <div>
                      <strong>{nomClient(x.client_id)}</strong>{" "}
                      <span className="discret">
                        · {x.numero} · {dateFr(x.date)}
                        {x.titre && ` · ${x.titre}`}
                      </span>
                      <div className="petit discret">
                        <strong>{euros(x.total_ttc)} TTC</strong> · {euros(x.total_ht)} HT · {heures(x.heures_prevues)} prévues
                        {x.heures_reelles !== null && ` · ${heures(x.heures_reelles)} réelles`}
                        {facture && ` · facture ${facture.numero}`}
                      </div>
                    </div>
                    <div className="rangee">
                      <span className={`badge ${s.badge}`}>{s.libelle}</span>
                      <select
                        className="select-petit"
                        value={x.statut}
                        aria-label="Statut"
                        onChange={(e) => agir(() => majDevis(x.id, { statut: e.target.value as StatutDevis }))}
                      >
                        {STATUTS.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.libelle}
                          </option>
                        ))}
                      </select>
                      <button className="bouton bouton--secondaire bouton--petit" onClick={() => props.ouvrir(x)}>
                        Ouvrir
                      </button>
                      {x.statut === "accepte" && !x.facture_id && (
                        <button
                          className="bouton bouton--petit"
                          onClick={() => {
                            const n = prompt("Numéro de la facture (échéance à 30 jours) :", suivantFacture(d.factures.map((f) => f.numero)));
                            if (n?.trim()) agir(() => facturerDevis(x, n, 30), true);
                          }}
                        >
                          Facturer
                        </button>
                      )}
                      {x.facture_id && (
                        <button
                          className="bouton bouton--texte bouton--petit"
                          onClick={() => {
                            const v = prompt(
                              `Temps réellement passé sur ce chantier, en heures (prévu : ${heures(x.heures_prevues)}) :`,
                              x.heures_reelles !== null ? txt(x.heures_reelles) : "",
                            );
                            if (v === null) return;
                            const h = v.trim() ? lireMontant(v) : null;
                            if (v.trim() && (h === null || h < 0)) return setErreur("Nombre d'heures illisible.");
                            agir(() => majDevis(x.id, { heures_reelles: h }));
                          }}
                        >
                          Temps réel
                        </button>
                      )}
                      <button
                        className="bouton bouton--texte bouton--petit"
                        onClick={() => confirm(`Supprimer le devis ${x.numero} ?`) && agir(() => supprimerDevis(x.id))}
                      >
                        Supprimer
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Carte>
    </>
  );
}

// --- Éditeur de devis --------------------------------------------------------------------

const COMBOS_CHANTS: { l: number; w: number; libelle: string }[] = [
  { l: 0, w: 0, libelle: "Aucun" },
  { l: 1, w: 0, libelle: "1 long" },
  { l: 2, w: 0, libelle: "2 longs" },
  { l: 1, w: 1, libelle: "1 long + 1 court" },
  { l: 1, w: 2, libelle: "1 long + 2 courts" },
  { l: 2, w: 1, libelle: "2 longs + 1 court" },
  { l: 2, w: 2, libelle: "Tour complet" },
];

const motsDe = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length > 3)
    .map((m) => m.replace(/[sx]$/, "").replace(/e$/, ""));

/** L'article du catalogue qui ressemble le plus au nom proposé par l'IA (au moins un mot en commun). */
function articleProche(nom: string, articles: Article[]): Article | undefined {
  const cible = new Set(motsDe(nom));
  let meilleur: Article | undefined;
  let score = 0;
  for (const a of articles) {
    const s = motsDe(a.nom).filter((m) => cible.has(m)).length;
    if (s > score) [meilleur, score] = [a, s];
  }
  return meilleur;
}

function Editeur(props: {
  d: Donnees;
  dd: DonneesDevis;
  initial: UnDevis | null;
  rechargerTout: () => Promise<void>;
  fermer: () => Promise<void>;
}) {
  const { d, dd } = props;
  const ini = props.initial;
  const panneaux = dd.articles.filter((a) => a.categorie === "panneau");
  const chantsCat = dd.articles.filter((a) => a.categorie === "chant");
  const autres = dd.articles.filter((a) => a.categorie !== "panneau" && a.categorie !== "chant");

  const [id, setId] = useState(ini?.id);
  const [numero, setNumero] = useState(() => ini?.numero ?? prochainNumero(dd.devis.map((x) => x.numero), Number(aujourdhui().slice(0, 4))));
  const [clientId, setClientId] = useState(ini?.client_id ?? "");
  const [titre, setTitre] = useState(ini?.titre ?? "");
  const [date, setDate] = useState(ini?.date ?? aujourdhui());
  const [notes, setNotes] = useState(ini?.notes ?? "");
  const [caissons, setCaissons] = useState(txt(ini?.caissons ?? 1));
  const [difficulte, setDifficulte] = useState(ini?.difficulte ?? 1);
  const [transport, setTransport] = useState(txt(ini?.transport_ht ?? 0));
  const [heuresSup, setHeuresSup] = useState(txt(ini?.heures_sup ?? 0));
  const [pieces, setPieces] = useState<Piece[]>(ini?.pieces ?? []);
  const [fournitures, setFournitures] = useState<Fourniture[]>(ini?.fournitures ?? []);
  const [erreur, setErreur] = useState("");
  const [message, setMessage] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [nouveauClient, setNouveauClient] = useState<{ nom: string; email: string } | null>(null);

  const panneauDefaut = panneaux[0]?.id ?? null;
  const chantDefaut = chantsCat[0]?.id ?? null;

  const parametres = {
    caissons: nb(caissons),
    difficulte,
    transport_ht: nb(transport),
    heures_sup: nb(heuresSup),
    pieces,
    fournitures,
  };
  const c = chiffrer(parametres, dd.reglages, dd.articles);

  const majPiece = (i: number, champs: Partial<Piece>) => setPieces((ps) => ps.map((p, j) => (j === i ? { ...p, ...champs } : p)));
  const majFourniture = (i: number, champs: Partial<Fourniture>) =>
    setFournitures((fs) => fs.map((f, j) => (j === i ? { ...f, ...champs } : f)));

  function appliquerPlan(p: PlanLu) {
    const mince = panneaux.find((a) => /\b(3|5|8) ?mm\b|hdf|fond/i.test(a.nom))?.id ?? panneauDefaut;
    const epais = panneaux.find((a) => /19 ?mm/i.test(a.nom))?.id ?? panneauDefaut;
    const lues: Piece[] = p.pieces.map((x) => ({
      ...pieceVide(x.epaisseur && x.epaisseur <= 10 ? mince : epais, chantDefaut),
      nom: x.nom,
      longueur: x.longueur,
      largeur: x.largeur,
      quantite: x.quantite,
      chants_longueur: x.chants_longueur,
      chants_largeur: x.chants_largeur,
    }));
    const acc: Fourniture[] = p.accessoires.map((x) => {
      const a = articleProche(x.nom, autres);
      return { id: nouvelId(), article_id: a?.id ?? null, libelle: a ? "" : x.nom, quantite: x.quantite, prix_ht: 0 };
    });
    const sansPrix = acc.filter((f) => !f.article_id).length;
    setPieces((ps) => [...ps.filter((x) => x.longueur || x.largeur || x.nom), ...lues]);
    setFournitures((fs) => [...fs, ...acc]);
    if (p.caissons) setCaissons(String(p.caissons));
    setMessage(
      `Plan lu : ${lues.length} pièce(s), ${acc.length} accessoire(s). Vérifiez chaque cote avant d'envoyer le devis.` +
        (sansPrix ? ` ${sansPrix} accessoire(s) absents du catalogue : indiquez leur prix.` : "") +
        (p.remarques ? ` Remarques de l'IA : ${p.remarques}` : "") +
        ` (${p.utilises}/${p.limite} plans lus ce mois-ci)`,
    );
  }

  function aEnregistrer() {
    return {
      id,
      client_id: clientId || null,
      numero: numero.trim(),
      titre: titre.trim(),
      date,
      statut: ini?.statut ?? ("brouillon" as StatutDevis),
      notes: notes.trim(),
      ...parametres,
      pieces: pieces.filter((p) => p.longueur > 0 && p.largeur > 0),
      fournitures: fournitures.filter((f) => f.quantite > 0),
      total_ht: c.total_ht,
      total_ttc: c.total_ttc,
      heures_prevues: c.heures_total,
    };
  }

  async function enregistrer(): Promise<UnDevis | null> {
    setErreur("");
    if (!numero.trim()) {
      setErreur("Indiquez le numéro du devis.");
      return null;
    }
    setEnCours(true);
    try {
      const x = await enregistrerDevis(aEnregistrer());
      setId(x.id);
      setMessage("Devis enregistré.");
      return x;
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
      return null;
    } finally {
      setEnCours(false);
    }
  }

  async function pdf() {
    if (!clientId) return setErreur("Choisissez le client avant de faire le PDF.");
    // La fenêtre doit s'ouvrir tout de suite au clic, sinon le navigateur la bloque
    const fenetre = window.open("", "_blank");
    const x = await enregistrer();
    if (!x) return fenetre?.close();
    try {
      imprimerDevis(fenetre, htmlDevis({ ...x, ...aEnregistrer(), id: x.id } as UnDevis, c, dd.reglages, d.entreprise, d.clients.find((k) => k.id === clientId)));
      if (x.statut === "brouillon") await majDevis(x.id, { statut: "envoye" });
    } catch (e) {
      fenetre?.close();
      setErreur(e instanceof Error ? e.message : "PDF impossible.");
    }
  }

  async function creerClient() {
    if (!nouveauClient?.nom.trim()) return setErreur("Indiquez le nom du client.");
    try {
      const k = await ajouterClient({ nom: nouveauClient.nom.trim(), email: nouveauClient.email.trim(), telephone: "", notes: "" });
      await props.rechargerTout();
      setClientId(k.id);
      setNouveauClient(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Client non créé.");
    }
  }

  return (
    <div className="pile">
      <div className="rangee rangee--entre">
        <button className="bouton bouton--texte" onClick={() => props.fermer()}>
          ‹ Mes devis
        </button>
        <strong>{id ? `Devis ${numero}` : "Nouveau devis"}</strong>
      </div>

      <Carte titre="Client et chantier">
        <div className="grille">
          <label className="champ">
            <span className="champ__label">
              Client<span className="requis"> *</span>
            </span>
            <select value={clientId} onChange={(e) => (e.target.value === "+" ? setNouveauClient({ nom: "", email: "" }) : setClientId(e.target.value))}>
              <option value="">Choisir…</option>
              {d.clients.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.nom}
                </option>
              ))}
              <option value="+">+ Nouveau client</option>
            </select>
          </label>
          <Champ label="Objet" value={titre} onChange={setTitre} placeholder="Placard 3 portes, chambre 2" />
          {nouveauClient && (
            <>
              <Champ label="Nom du nouveau client" value={nouveauClient.nom} onChange={(v) => setNouveauClient({ ...nouveauClient, nom: v })} />
              <div className="rangee" style={{ alignItems: "flex-end" }}>
                <Champ label="Email" value={nouveauClient.email} onChange={(v) => setNouveauClient({ ...nouveauClient, email: v })} />
                <button className="bouton bouton--secondaire" onClick={creerClient}>
                  Ajouter
                </button>
              </div>
            </>
          )}
          <Champ label="N° de devis" requis value={numero} onChange={setNumero} />
          <Champ label="Date" type="date" value={date} onChange={setDate} />
          <Zone label="Description (visible par le client)" value={notes} onChange={setNotes} lignes={2} placeholder="Mélaminé blanc, 3 portes battantes, 2 tiroirs, penderie à gauche…" />
        </div>
      </Carte>

      <LecturePlan appliquer={appliquerPlan} plansCeMois={dd.plansCeMois} />
      {message && <p className="info">{message}</p>}

      <Carte titre="Pièces à découper" sousTitre="Dimensions finies en millimètres. Chants : côtés plaqués.">
        {panneaux.length === 0 && <p className="attention">Ajoutez au moins un panneau dans le catalogue de prix.</p>}
        <div className="lignes-pieces">
          {pieces.map((p, i) => (
            <div key={p.id} className="ligne-piece">
              <input aria-label="Nom de la pièce" placeholder="Côté, étagère…" value={p.nom} onChange={(e) => majPiece(i, { nom: e.target.value })} />
              <input aria-label="Longueur (mm)" placeholder="Long. mm" inputMode="numeric" value={p.longueur || ""} onChange={(e) => majPiece(i, { longueur: nb(e.target.value) })} />
              <input aria-label="Largeur (mm)" placeholder="Larg. mm" inputMode="numeric" value={p.largeur || ""} onChange={(e) => majPiece(i, { largeur: nb(e.target.value) })} />
              <input aria-label="Quantité" placeholder="Qté" inputMode="numeric" value={p.quantite || ""} onChange={(e) => majPiece(i, { quantite: Math.round(nb(e.target.value)) })} />
              <select aria-label="Panneau" value={p.panneau_id ?? ""} onChange={(e) => majPiece(i, { panneau_id: e.target.value || null })}>
                <option value="">Panneau…</option>
                {panneaux.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                  </option>
                ))}
              </select>
              <select
                aria-label="Chants"
                value={`${p.chants_longueur}-${p.chants_largeur}`}
                onChange={(e) => {
                  const [l, w] = e.target.value.split("-").map(Number);
                  majPiece(i, { chants_longueur: l, chants_largeur: w });
                }}
              >
                {COMBOS_CHANTS.map((k) => (
                  <option key={k.libelle} value={`${k.l}-${k.w}`}>
                    Chants : {k.libelle}
                  </option>
                ))}
              </select>
              <select aria-label="Chant" value={p.chant_id ?? ""} onChange={(e) => majPiece(i, { chant_id: e.target.value || null })}>
                <option value="">Chant…</option>
                {chantsCat.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nom}
                  </option>
                ))}
              </select>
              <button className="bouton bouton--texte bouton--icone" aria-label="Retirer la pièce" onClick={() => setPieces((ps) => ps.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button
            className="bouton bouton--texte"
            onClick={() => setPieces((ps) => [...ps, pieceVide(ps.at(-1)?.panneau_id ?? panneauDefaut, ps.at(-1)?.chant_id ?? chantDefaut)])}
          >
            + Pièce
          </button>
        </div>
      </Carte>

      <Carte titre="Quincaillerie et accessoires">
        <div className="lignes-pieces">
          {fournitures.map((f, i) => {
            const a = dd.articles.find((x) => x.id === f.article_id);
            return (
              <div key={f.id} className="ligne-fourniture">
                <select
                  aria-label="Article"
                  value={f.article_id ?? ""}
                  onChange={(e) => majFourniture(i, { article_id: e.target.value || null })}
                >
                  <option value="">Ligne libre (hors catalogue)</option>
                  {autres.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.nom} – {euros(x.prix_ht)}/{LIBELLE_UNITE[x.unite]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Quantité"
                  placeholder={a?.unite === "ml" ? "mètres" : "Qté"}
                  inputMode="decimal"
                  value={txt(f.quantite)}
                  onChange={(e) => majFourniture(i, { quantite: nb(e.target.value) })}
                />
                {!a ? (
                  <>
                    <input aria-label="Désignation" placeholder="Désignation" value={f.libelle} onChange={(e) => majFourniture(i, { libelle: e.target.value })} />
                    <input aria-label="Prix unitaire HT" placeholder="Prix HT" inputMode="decimal" value={txt(f.prix_ht)} onChange={(e) => majFourniture(i, { prix_ht: nb(e.target.value) })} />
                  </>
                ) : (
                  <span className="discret petit" style={{ gridColumn: "span 2" }}>
                    {euros(f.quantite * a.prix_ht)} HT
                  </span>
                )}
                <button
                  className="bouton bouton--texte bouton--icone"
                  aria-label="Retirer"
                  onClick={() => setFournitures((fs) => fs.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            className="bouton bouton--texte"
            onClick={() => setFournitures((fs) => [...fs, { id: nouvelId(), article_id: autres[0]?.id ?? null, libelle: "", quantite: 1, prix_ht: 0 }])}
          >
            + Accessoire
          </button>
        </div>
      </Carte>

      <Carte titre="Fabrication et pose">
        <div className="grille">
          <Champ label="Nombre de caissons / modules" value={caissons} onChange={setCaissons} aide="Sert au temps de montage, de vérification, de nettoyage et de pose." />
          <label className="champ">
            <span className="champ__label">Difficulté du chantier</span>
            <select value={difficulte} onChange={(e) => setDifficulte(Number(e.target.value))}>
              {DIFFICULTES.map((x) => (
                <option key={x.valeur} value={x.valeur}>
                  {x.libelle} (× {String(x.valeur).replace(".", ",")})
                </option>
              ))}
            </select>
          </label>
          <Champ label="Transport / livraison HT (€)" value={transport} onChange={setTransport} />
          <Champ label="Temps ajouté (heures)" value={heuresSup} onChange={setHeuresSup} aide="Étude, finition spéciale, découpe d'un mur…" />
        </div>
      </Carte>

      <Resume c={c} r={dd.reglages} />

      {erreur && <p className="erreur">{erreur}</p>}
      <div className="barre-action barre-action--collante">
        <div className="total">
          Total TTC <strong>{euros(c.total_ttc)}</strong>
          <span className="petit"> · {heures(c.heures_total)}</span>
        </div>
        <div className="rangee">
          <button className="bouton bouton--secondaire" disabled={enCours} onClick={pdf}>
            Devis PDF
          </button>
          <button className="bouton" disabled={enCours} onClick={enregistrer}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LecturePlan(props: { appliquer: (p: PlanLu) => void; plansCeMois: number }) {
  const [precisions, setPrecisions] = useState("");
  const [etat, setEtat] = useState("");
  const [erreur, setErreur] = useState("");

  async function lire(f: File) {
    setErreur("");
    setEtat(`Lecture de « ${f.name.slice(0, 40)} »… (jusqu'à 1 min)`);
    try {
      props.appliquer(await lirePlan(f, precisions));
      setEtat("");
    } catch (e) {
      setEtat("");
      setErreur(e instanceof Error ? e.message : "Lecture impossible.");
    }
  }

  return (
    <Carte titre="Lire un plan d'architecte" sousTitre="L'IA propose la liste des pièces et des accessoires : vous vérifiez avant de chiffrer.">
      <div className="depot-pdf">
        <label className="bouton bouton--secondaire">
          {etat || "Choisir le plan (PDF ou photo)"}
          <input
            type="file"
            hidden
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={!!etat}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) lire(f);
            }}
          />
        </label>
        <span className="discret petit">{props.plansCeMois} plan(s) lu(s) ce mois-ci.</span>
      </div>
      <Champ
        label="Précisions pour l'IA (facultatif)"
        large
        value={precisions}
        onChange={setPrecisions}
        placeholder="Ex. : seulement le placard de l'entrée, fond en 8 mm, pas de portes"
      />
      {erreur && <p className="erreur">{erreur}</p>}
    </Carte>
  );
}

function Resume(props: { c: ReturnType<typeof chiffrer>; r: Reglages }) {
  const { c, r } = props;
  return (
    <Carte titre="Chiffrage" sousTitre="Ce détail reste interne : le devis PDF ne montre ni vos prix d'achat ni votre marge.">
      {c.avertissements.map((a) => (
        <p key={a} className="attention petit">
          ⚠ {a}
        </p>
      ))}
      <table className="tableau">
        <thead>
          <tr>
            <th>Matériaux</th>
            <th className="m">Quantité</th>
            <th className="m">Achat HT</th>
          </tr>
        </thead>
        <tbody>
          {c.materiaux.length === 0 && (
            <tr>
              <td colSpan={3} className="discret">
                Aucun matériau pour l'instant.
              </td>
            </tr>
          )}
          {c.materiaux.map((m, i) => (
            <tr key={i}>
              <td>
                {m.libelle}
                <div className="petit discret">{m.detail}</div>
              </td>
              <td className="m">
                {String(m.quantite).replace(".", ",")} {m.unite}
              </td>
              <td className="m">{euros(m.cout_ht)}</td>
            </tr>
          ))}
          <tr>
            <td>Marge sur les matériaux ({String(r.marge_pct).replace(".", ",")} %)</td>
            <td />
            <td className="m">{euros(c.marge)}</td>
          </tr>
        </tbody>
      </table>
      <table className="tableau">
        <thead>
          <tr>
            <th>Temps</th>
            <th className="m">Calcul</th>
            <th className="m">Minutes</th>
          </tr>
        </thead>
        <tbody>
          {c.temps.map((t) => (
            <tr key={t.libelle}>
              <td>{t.libelle}</td>
              <td className="m petit discret">{t.detail}</td>
              <td className="m">{Math.round(t.minutes)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>
              Atelier {heures(c.heures_fabrication)} + pose {heures(c.heures_pose)}, difficulté comprise, × {euros(r.taux_horaire)}/h
            </td>
            <td className="m">{euros(c.main_oeuvre)}</td>
          </tr>
        </tbody>
      </table>
      <table className="tableau tableau--totaux">
        <tbody>
          <tr>
            <td>Matériaux vendus</td>
            <td className="m">{euros(c.vente_materiaux)}</td>
          </tr>
          <tr>
            <td>Main-d'œuvre ({heures(c.heures_total)})</td>
            <td className="m">{euros(c.main_oeuvre)}</td>
          </tr>
          <tr>
            <td>Transport</td>
            <td className="m">{euros(c.transport)}</td>
          </tr>
          <tr>
            <td>
              <strong>Total HT</strong>
            </td>
            <td className="m">
              <strong>{euros(c.total_ht)}</strong>
            </td>
          </tr>
          <tr>
            <td>TVA {String(r.tva_pct).replace(".", ",")} %</td>
            <td className="m">{euros(c.tva)}</td>
          </tr>
          <tr>
            <td>
              <strong>Total TTC</strong>
            </td>
            <td className="m">
              <strong>{euros(c.total_ttc)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </Carte>
  );
}

// --- Catalogue ---------------------------------------------------------------------------

type ArticleEdite = { id?: string; categorie: Categorie; nom: string; fournisseur: string; unite: Unite; prix: string; longueur: string; largeur: string; minutes: string };

const versEdite = (a: Article): ArticleEdite => ({
  id: a.id,
  categorie: a.categorie,
  nom: a.nom,
  fournisseur: a.fournisseur,
  unite: a.unite,
  prix: txt(a.prix_ht),
  longueur: a.longueur_mm ? String(a.longueur_mm) : "",
  largeur: a.largeur_mm ? String(a.largeur_mm) : "",
  minutes: a.minutes_pose === null ? "" : txt(a.minutes_pose),
});

function Catalogue(props: { dd: DonneesDevis; recharger: () => Promise<void> }) {
  const [edite, setEdite] = useState<ArticleEdite | null>(null);
  const [erreur, setErreur] = useState("");

  async function enregistrer() {
    if (!edite) return;
    setErreur("");
    const prix = lireMontant(edite.prix);
    if (!edite.nom.trim()) return setErreur("Indiquez le nom de l'article.");
    if (prix === null || prix < 0) return setErreur("Prix illisible.");
    const panneau = edite.categorie === "panneau";
    try {
      await enregistrerArticle({
        id: edite.id,
        categorie: edite.categorie,
        nom: edite.nom.trim(),
        fournisseur: edite.fournisseur.trim(),
        unite: panneau ? (edite.unite === "m2" ? "m2" : "panneau") : edite.categorie === "chant" ? "ml" : edite.unite,
        prix_ht: prix,
        longueur_mm: panneau && nb(edite.longueur) ? Math.round(nb(edite.longueur)) : null,
        largeur_mm: panneau && nb(edite.largeur) ? Math.round(nb(edite.largeur)) : null,
        minutes_pose: edite.minutes.trim() ? nb(edite.minutes) : null,
      });
      setEdite(null);
      await props.recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  return (
    <>
      <p className="info">
        Mettez ici les prix d'achat HT de vos fournisseurs. Les prix de départ sont des exemples : remplacez-les par les vôtres.
      </p>
      {edite && (
        <Carte
          titre={edite.id ? "Modifier l'article" : "Nouvel article"}
          actions={
            <button className="bouton bouton--texte" onClick={() => setEdite(null)}>
              Fermer
            </button>
          }
        >
          <div className="grille">
            <label className="champ">
              <span className="champ__label">Catégorie</span>
              <select value={edite.categorie} onChange={(e) => setEdite({ ...edite, categorie: e.target.value as Categorie })}>
                {CATEGORIES_ARTICLE.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.libelle}
                  </option>
                ))}
              </select>
            </label>
            <Champ label="Nom" requis value={edite.nom} onChange={(v) => setEdite({ ...edite, nom: v })} />
            <Champ label="Fournisseur" value={edite.fournisseur} onChange={(v) => setEdite({ ...edite, fournisseur: v })} />
            {edite.categorie === "panneau" ? (
              <label className="champ">
                <span className="champ__label">Vendu</span>
                <select value={edite.unite === "m2" ? "m2" : "panneau"} onChange={(e) => setEdite({ ...edite, unite: e.target.value as Unite })}>
                  <option value="panneau">au panneau entier</option>
                  <option value="m2">au m²</option>
                </select>
              </label>
            ) : edite.categorie !== "chant" ? (
              <label className="champ">
                <span className="champ__label">Unité</span>
                <select value={edite.unite === "ml" ? "ml" : "u"} onChange={(e) => setEdite({ ...edite, unite: e.target.value as Unite })}>
                  <option value="u">à la pièce</option>
                  <option value="ml">au mètre</option>
                </select>
              </label>
            ) : null}
            <Champ
              label={`Prix d'achat HT (€ ${edite.categorie === "chant" ? "par mètre" : edite.categorie === "panneau" ? (edite.unite === "m2" ? "par m²" : "par panneau") : edite.unite === "ml" ? "par mètre" : "pièce"})`}
              requis
              value={edite.prix}
              onChange={(v) => setEdite({ ...edite, prix: v })}
            />
            {edite.categorie === "panneau" && edite.unite !== "m2" && (
              <>
                <Champ label="Longueur du panneau (mm)" value={edite.longueur} onChange={(v) => setEdite({ ...edite, longueur: v })} placeholder="2800" />
                <Champ label="Largeur du panneau (mm)" value={edite.largeur} onChange={(v) => setEdite({ ...edite, largeur: v })} placeholder="2070" />
              </>
            )}
            {(edite.categorie === "quincaillerie" || edite.categorie === "accessoire" || edite.categorie === "autre") && (
              <Champ
                label="Temps de pose (minutes)"
                value={edite.minutes}
                onChange={(v) => setEdite({ ...edite, minutes: v })}
                aide="Vide = temps standard réglé dans « Temps et taux »."
              />
            )}
          </div>
          {erreur && <p className="erreur">{erreur}</p>}
          <button className="bouton" onClick={enregistrer}>
            Enregistrer
          </button>
        </Carte>
      )}
      {CATEGORIES_ARTICLE.map((k) => {
        const liste = props.dd.articles.filter((a) => a.categorie === k.id);
        return (
          <Carte
            key={k.id}
            titre={k.libelle}
            actions={
              <button
                className="bouton bouton--secondaire bouton--petit"
                onClick={() =>
                  setEdite({ categorie: k.id, nom: "", fournisseur: "", unite: k.id === "panneau" ? "panneau" : k.id === "chant" ? "ml" : "u", prix: "", longueur: "", largeur: "", minutes: "" })
                }
              >
                + Ajouter
              </button>
            }
          >
            {liste.length === 0 ? (
              <p className="discret petit">Aucun article.</p>
            ) : (
              <ul className="liste">
                {liste.map((a) => (
                  <li key={a.id}>
                    <div className="rangee rangee--entre">
                      <div>
                        <strong>{a.nom}</strong>
                        <div className="petit discret">
                          {euros(a.prix_ht)} HT / {LIBELLE_UNITE[a.unite]}
                          {a.longueur_mm && a.largeur_mm ? ` · ${a.longueur_mm} × ${a.largeur_mm} mm` : ""}
                          {a.minutes_pose !== null ? ` · pose ${txt(a.minutes_pose) || 0} min` : ""}
                          {a.fournisseur && ` · ${a.fournisseur}`}
                        </div>
                      </div>
                      <div className="rangee">
                        <button className="bouton bouton--texte bouton--petit" onClick={() => setEdite(versEdite(a))}>
                          Modifier
                        </button>
                        <button
                          className="bouton bouton--texte bouton--petit"
                          onClick={async () => {
                            if (!confirm(`Supprimer « ${a.nom} » du catalogue ?`)) return;
                            await supprimerArticle(a.id).catch((e) => setErreur(e.message));
                            await props.recharger();
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Carte>
        );
      })}
    </>
  );
}

// --- Temps et taux -----------------------------------------------------------------------

const CHAMPS_TEMPS: { cle: keyof Reglages; label: string; aide: string }[] = [
  { cle: "min_coupe", label: "Sciage (min par pièce)", aide: "Débit d'une pièce à la scie." },
  { cle: "min_chant_ml", label: "Placage de chant (min par mètre)", aide: "Plaqueuse + affleurage + nettoyage du chant." },
  { cle: "min_quincaillerie", label: "Pose d'un accessoire (min)", aide: "Charnière, coulisse, poignée… (modifiable par article)." },
  { cle: "min_montage", label: "Montage (min par caisson)", aide: "Assemblage d'un caisson." },
  { cle: "min_verification", label: "Vérification (min par caisson)", aide: "Équerrage, réglages, contrôle." },
  { cle: "min_nettoyage", label: "Nettoyage (min par caisson)", aide: "Avant emballage / livraison." },
  { cle: "min_pose", label: "Pose chez le client (min par caisson)", aide: "Mise en place, calage, fixation, réglages." },
];

const CHAMPS_TAUX: { cle: keyof Reglages; label: string; aide?: string }[] = [
  { cle: "taux_horaire", label: "Taux horaire HT (€)", aide: "Prix de vente d'une heure de travail." },
  { cle: "marge_pct", label: "Marge sur les matériaux (%)", aide: "Ajoutée au prix d'achat des fournitures." },
  { cle: "chute_pct", label: "Chute des panneaux (%)", aide: "Perte à la découpe, ajoutée à la surface des pièces." },
  { cle: "tva_pct", label: "TVA (%)", aide: "20 % en général, 10 % pour certains travaux de rénovation." },
  { cle: "validite_jours", label: "Validité du devis (jours)" },
];

function ReglagesDevis(props: { uid: string; dd: DonneesDevis; recharger: () => Promise<void> }) {
  const [valeurs, setValeurs] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(props.dd.reglages).map(([k, v]) => [k, typeof v === "number" ? txt(v) || "0" : String(v)])),
  );
  const [erreur, setErreur] = useState("");
  const [ok, setOk] = useState(false);

  async function enregistrer() {
    setErreur("");
    setOk(false);
    const r = { ...props.dd.reglages };
    for (const { cle, label } of [...CHAMPS_TAUX, ...CHAMPS_TEMPS]) {
      const n = lireMontant(valeurs[cle] ?? "");
      if (n === null || n < 0) return setErreur(`${label} : valeur illisible.`);
      (r as Record<string, unknown>)[cle] = cle === "validite_jours" ? Math.max(1, Math.round(n)) : n;
    }
    r.conditions = valeurs.conditions ?? "";
    try {
      await enregistrerReglages(props.uid, r);
      await props.recharger();
      setOk(true);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Enregistrement impossible.");
    }
  }

  const champ = (cle: keyof Reglages, label: string, aide?: string) => (
    <Champ key={cle} label={label} aide={aide} value={valeurs[cle] ?? ""} onChange={(v) => setValeurs({ ...valeurs, [cle]: v })} />
  );

  return (
    <>
      <Carte titre="Prix et marge">
        <div className="grille">{CHAMPS_TAUX.map((x) => champ(x.cle, x.label, x.aide))}</div>
      </Carte>
      <Carte
        titre="Temps standards"
        sousTitre="Le plus important pour ne pas perdre d'argent. Après chaque chantier, notez le temps réel : l'onglet « Mes devis » vous dira si ces temps sont justes."
      >
        <div className="grille">{CHAMPS_TEMPS.map((x) => champ(x.cle, x.label, x.aide))}</div>
      </Carte>
      <Carte titre="Conditions affichées sur le devis">
        <Zone label="Conditions de paiement" value={valeurs.conditions ?? ""} onChange={(v) => setValeurs({ ...valeurs, conditions: v })} />
      </Carte>
      {erreur && <p className="erreur">{erreur}</p>}
      {ok && <p className="succes">Réglages enregistrés.</p>}
      <button className="bouton" onClick={enregistrer}>
        Enregistrer
      </button>
    </>
  );
}
