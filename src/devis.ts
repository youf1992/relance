// Chiffrage d'un devis de menuiserie sur mesure (placards, dressings, meubles).
// Tout est calculé ici, sans IA : même placard = même prix, et chaque euro est expliqué.
//
//   matériaux (panneaux + chute, chants, quincaillerie)  × (1 + marge)
// + temps (sciage, chants, quincaillerie, montage, vérification, nettoyage, pose) × difficulté × taux horaire
// + transport
// = total HT, puis TVA.

export type Categorie = "panneau" | "chant" | "quincaillerie" | "accessoire" | "autre";
export type Unite = "u" | "ml" | "m2" | "panneau";

export interface Article {
  id: string;
  categorie: Categorie;
  nom: string;
  fournisseur: string;
  unite: Unite;
  prix_ht: number;
  longueur_mm: number | null;
  largeur_mm: number | null;
  /** Minutes pour poser un élément ; null = temps standard (accessoire à l'unité) ou rien. */
  minutes_pose: number | null;
}

export interface Reglages {
  taux_horaire: number;
  marge_pct: number;
  chute_pct: number;
  tva_pct: number;
  validite_jours: number;
  min_coupe: number;
  min_chant_ml: number;
  min_montage: number;
  min_quincaillerie: number;
  min_verification: number;
  min_nettoyage: number;
  min_pose: number;
  conditions: string;
}

export const REGLAGES_PAR_DEFAUT: Reglages = {
  taux_horaire: 45,
  marge_pct: 30,
  chute_pct: 15,
  tva_pct: 20,
  validite_jours: 30,
  min_coupe: 3,
  min_chant_ml: 1.5,
  min_montage: 45,
  min_quincaillerie: 5,
  min_verification: 10,
  min_nettoyage: 10,
  min_pose: 60,
  conditions: "Acompte de 30 % à la commande, solde à la pose.",
};

/** Une pièce découpée dans un panneau. Chants : nombre de côtés plaqués (0 à 2) sur la longueur et sur la largeur. */
export interface Piece {
  id: string;
  nom: string;
  longueur: number; // mm
  largeur: number; // mm
  quantite: number;
  panneau_id: string | null;
  chant_id: string | null;
  chants_longueur: number; // 0, 1 ou 2
  chants_largeur: number; // 0, 1 ou 2
}

/** Quincaillerie, accessoire ou autre fourniture à l'unité / au mètre. */
export interface Fourniture {
  id: string;
  article_id: string | null;
  libelle: string; // si pas d'article (ligne libre)
  quantite: number;
  prix_ht: number; // utilisé seulement pour une ligne libre
}

export interface ParametresDevis {
  caissons: number;
  difficulte: number;
  transport_ht: number;
  heures_sup: number;
  pieces: Piece[];
  fournitures: Fourniture[];
}

export interface LigneMateriau {
  libelle: string;
  detail: string;
  quantite: number;
  unite: string;
  cout_ht: number;
}

export interface LigneTemps {
  libelle: string;
  detail: string;
  minutes: number;
}

export interface Chiffrage {
  materiaux: LigneMateriau[];
  temps: LigneTemps[];
  avertissements: string[];
  cout_materiaux: number;
  vente_materiaux: number; // matériaux + marge
  heures_fabrication: number; // après difficulté
  heures_pose: number; // après difficulté
  heures_total: number;
  main_oeuvre: number;
  transport: number;
  total_ht: number;
  tva: number;
  total_ttc: number;
  marge: number; // part de marge sur les matériaux
}

/** Les chants sont commandés avec 10 % de longueur en plus (débords coupés à l'affleureuse). */
export const SURPLUS_CHANT = 0.1;

const arrondi = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
/** 11.41 → « 11,41 » */
const fr = (n: number, d = 2) => arrondi(n, d).toLocaleString("fr-FR", { maximumFractionDigits: d });
const positif = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export const LIBELLE_UNITE: Record<Unite, string> = { u: "u", ml: "ml", m2: "m²", panneau: "panneau" };

export function chiffrer(p: ParametresDevis, r: Reglages, articles: Article[]): Chiffrage {
  const parId = new Map(articles.map((a) => [a.id, a]));
  const materiaux: LigneMateriau[] = [];
  const avertissements: string[] = [];
  const pieces = p.pieces.filter((x) => positif(x.longueur) && positif(x.largeur) && positif(x.quantite));
  const chute = positif(r.chute_pct) / 100;

  // --- Panneaux : surface des pièces, + chute, arrondie au panneau entier si le format est connu
  const surfaces = new Map<string, number>();
  let sansPanneau = 0;
  for (const x of pieces) {
    const s = (x.longueur * x.largeur * x.quantite) / 1e6;
    const a = x.panneau_id ? parId.get(x.panneau_id) : undefined;
    if (!a) {
      sansPanneau += x.quantite;
      continue;
    }
    surfaces.set(a.id, (surfaces.get(a.id) ?? 0) + s);
    const lp = a.longueur_mm ?? 0;
    const wp = a.largeur_mm ?? 0;
    if (lp && wp && !((x.longueur <= lp && x.largeur <= wp) || (x.longueur <= wp && x.largeur <= lp)))
      avertissements.push(`« ${x.nom || "Pièce"} » (${x.longueur} × ${x.largeur}) est plus grande que le panneau ${a.nom}.`);
  }
  if (sansPanneau) avertissements.push(`${sansPanneau} pièce(s) sans panneau choisi : leur matière n'est pas comptée.`);
  for (const [id, surface] of surfaces) {
    const a = parId.get(id)!;
    const avecChute = surface * (1 + chute);
    const formatM2 = ((a.longueur_mm ?? 0) * (a.largeur_mm ?? 0)) / 1e6;
    if (a.unite === "panneau" && formatM2 > 0) {
      const nb = Math.ceil(avecChute / formatM2 - 1e-9);
      materiaux.push({
        libelle: a.nom,
        detail: `${fr(surface)} m² de pièces + ${fr(r.chute_pct)} % de chute = ${fr(avecChute)} m² → ${nb} panneau${nb > 1 ? "x" : ""} de ${a.longueur_mm} × ${a.largeur_mm}`,
        quantite: nb,
        unite: "panneau",
        cout_ht: arrondi(nb * a.prix_ht),
      });
    } else {
      if (a.unite === "panneau") avertissements.push(`Indiquez le format (longueur × largeur) du panneau ${a.nom} dans le catalogue.`);
      const prixM2 = a.unite === "panneau" ? 0 : a.prix_ht;
      materiaux.push({
        libelle: a.nom,
        detail: `${fr(surface)} m² de pièces + ${fr(r.chute_pct)} % de chute`,
        quantite: arrondi(avecChute),
        unite: "m²",
        cout_ht: arrondi(avecChute * prixM2),
      });
    }
  }

  // --- Chants ABS : mètres linéaires des côtés plaqués
  const chants = new Map<string, number>();
  let mlChantTotal = 0;
  let chantSansArticle = 0;
  for (const x of pieces) {
    const ml = ((clamp(x.chants_longueur) * x.longueur + clamp(x.chants_largeur) * x.largeur) * x.quantite) / 1000;
    if (!ml) continue;
    mlChantTotal += ml;
    const a = x.chant_id ? parId.get(x.chant_id) : undefined;
    if (!a) chantSansArticle += ml;
    else chants.set(a.id, (chants.get(a.id) ?? 0) + ml);
  }
  for (const [id, ml] of chants) {
    const a = parId.get(id)!;
    const commande = arrondi(ml * (1 + SURPLUS_CHANT), 1);
    materiaux.push({
      libelle: a.nom,
      detail: `${fr(ml, 1)} ml plaqués + 10 % de surplus`,
      quantite: commande,
      unite: "ml",
      cout_ht: arrondi(commande * a.prix_ht),
    });
  }
  if (chantSansArticle) avertissements.push(`${fr(chantSansArticle, 1)} ml de chant sans article choisi : non comptés en matière.`);

  // --- Quincaillerie, accessoires, lignes libres
  let nbAPoser = 0;
  let minAPoser = 0;
  for (const f of p.fournitures) {
    const q = positif(f.quantite);
    if (!q) continue;
    const a = f.article_id ? parId.get(f.article_id) : undefined;
    const prix = a ? a.prix_ht : positif(f.prix_ht);
    // Chaque accessoire à l'unité se pose à la main (charnière, coulisse, poignée…)
    const minutes =
      a?.minutes_pose ?? (a && (a.categorie === "quincaillerie" || a.categorie === "accessoire") && a.unite === "u" ? r.min_quincaillerie : 0);
    if (minutes > 0) {
      if (a?.unite === "u") nbAPoser += q;
      minAPoser += q * minutes;
    }
    materiaux.push({
      libelle: a ? a.nom : f.libelle || "Fourniture",
      detail: a ? `${fr(q)} × ${fr(prix)} €` : "ligne libre",
      quantite: q,
      unite: a ? LIBELLE_UNITE[a.unite] : "u",
      cout_ht: arrondi(q * prix),
    });
  }

  // --- Temps
  const nbPieces = pieces.reduce((s, x) => s + x.quantite, 0);
  const caissons = positif(p.caissons);
  const temps: LigneTemps[] = [
    { libelle: "Sciage", detail: `${nbPieces} pièce(s) × ${fr(r.min_coupe)} min`, minutes: nbPieces * r.min_coupe },
    {
      libelle: "Placage de chants",
      detail: `${fr(mlChantTotal, 1)} ml × ${fr(r.min_chant_ml)} min`,
      minutes: mlChantTotal * r.min_chant_ml,
    },
    {
      libelle: "Pose quincaillerie",
      detail: `${fr(nbAPoser, 0)} élément(s)${minAPoser ? `, ${fr(minAPoser, 0)} min au total` : ""}`,
      minutes: minAPoser,
    },
    { libelle: "Montage", detail: `${caissons} caisson(s) × ${fr(r.min_montage)} min`, minutes: caissons * r.min_montage },
    {
      libelle: "Vérification",
      detail: `${caissons} caisson(s) × ${fr(r.min_verification)} min`,
      minutes: caissons * r.min_verification,
    },
    { libelle: "Nettoyage", detail: `${caissons} caisson(s) × ${fr(r.min_nettoyage)} min`, minutes: caissons * r.min_nettoyage },
  ];
  const minPose = caissons * r.min_pose;
  temps.push({ libelle: "Pose chez le client", detail: `${caissons} caisson(s) × ${fr(r.min_pose)} min`, minutes: minPose });
  if (positif(p.heures_sup)) temps.push({ libelle: "Temps ajouté", detail: "saisi à la main", minutes: p.heures_sup * 60 });

  const difficulte = p.difficulte > 0 ? p.difficulte : 1;
  const minFabrication = temps.filter((t) => t.libelle !== "Pose chez le client").reduce((s, t) => s + t.minutes, 0);
  const heures_fabrication = arrondi((minFabrication * difficulte) / 60);
  const heures_pose = arrondi((minPose * difficulte) / 60);
  const heures_total = arrondi(heures_fabrication + heures_pose);

  const cout_materiaux = arrondi(materiaux.reduce((s, m) => s + m.cout_ht, 0));
  const marge = arrondi((cout_materiaux * positif(r.marge_pct)) / 100);
  const vente_materiaux = arrondi(cout_materiaux + marge);
  const main_oeuvre = arrondi(heures_total * positif(r.taux_horaire));
  const transport = arrondi(positif(p.transport_ht));
  const total_ht = arrondi(vente_materiaux + main_oeuvre + transport);
  const tva = arrondi((total_ht * positif(r.tva_pct)) / 100);

  return {
    materiaux,
    temps,
    avertissements,
    cout_materiaux,
    vente_materiaux,
    heures_fabrication,
    heures_pose,
    heures_total,
    main_oeuvre,
    transport,
    total_ht,
    tva,
    total_ttc: arrondi(total_ht + tva),
    marge,
  };
}

function clamp(n: number) {
  return Math.max(0, Math.min(2, Math.round(Number(n) || 0)));
}

export const DIFFICULTES = [
  { valeur: 1, libelle: "Normale" },
  { valeur: 1.15, libelle: "Un peu difficile (murs pas d'équerre, étage sans ascenseur)" },
  { valeur: 1.3, libelle: "Difficile (sous pente, accès compliqué)" },
  { valeur: 1.5, libelle: "Très difficile" },
];

/** « 2026-D-007 » : suivant du plus grand numéro de l'année. */
export function prochainNumero(existants: string[], annee: number): string {
  const prefixe = `${annee}-D-`;
  const max = existants
    .filter((n) => n.startsWith(prefixe))
    .map((n) => Number(n.slice(prefixe.length)))
    .filter(Number.isFinite)
    .reduce((m, n) => Math.max(m, n), 0);
  return `${prefixe}${String(max + 1).padStart(3, "0")}`;
}

export const nouvelId = () => crypto.randomUUID();

export const pieceVide = (panneau: string | null = null, chant: string | null = null): Piece => ({
  id: nouvelId(),
  nom: "",
  longueur: 0,
  largeur: 0,
  quantite: 1,
  panneau_id: panneau,
  chant_id: chant,
  chants_longueur: 1,
  chants_largeur: 0,
});

/** Catalogue de départ : prix indicatifs à remplacer par ceux des fournisseurs. */
export const ARTICLES_EXEMPLE: Omit<Article, "id">[] = [
  { categorie: "panneau", nom: "Mélaminé blanc 19 mm", fournisseur: "", unite: "panneau", prix_ht: 55, longueur_mm: 2800, largeur_mm: 2070, minutes_pose: null },
  { categorie: "panneau", nom: "Mélaminé chêne 19 mm", fournisseur: "", unite: "panneau", prix_ht: 85, longueur_mm: 2800, largeur_mm: 2070, minutes_pose: null },
  { categorie: "panneau", nom: "Fond HDF blanc 3 mm", fournisseur: "", unite: "panneau", prix_ht: 18, longueur_mm: 2800, largeur_mm: 2070, minutes_pose: null },
  { categorie: "chant", nom: "Chant ABS blanc 23 × 1 mm", fournisseur: "", unite: "ml", prix_ht: 0.45, longueur_mm: null, largeur_mm: null, minutes_pose: null },
  { categorie: "chant", nom: "Chant ABS chêne 23 × 1 mm", fournisseur: "", unite: "ml", prix_ht: 0.7, longueur_mm: null, largeur_mm: null, minutes_pose: null },
  { categorie: "quincaillerie", nom: "Charnière invisible 110°", fournisseur: "", unite: "u", prix_ht: 2.2, longueur_mm: null, largeur_mm: null, minutes_pose: null },
  { categorie: "quincaillerie", nom: "Coulisses de tiroir (paire)", fournisseur: "", unite: "u", prix_ht: 14, longueur_mm: null, largeur_mm: null, minutes_pose: null },
  { categorie: "quincaillerie", nom: "Taquet d'étagère", fournisseur: "", unite: "u", prix_ht: 0.12, longueur_mm: null, largeur_mm: null, minutes_pose: 0.5 },
  { categorie: "accessoire", nom: "Barre de penderie ovale", fournisseur: "", unite: "ml", prix_ht: 6, longueur_mm: null, largeur_mm: null, minutes_pose: 5 },
  { categorie: "accessoire", nom: "Support de penderie", fournisseur: "", unite: "u", prix_ht: 1.5, longueur_mm: null, largeur_mm: null, minutes_pose: null },
  { categorie: "accessoire", nom: "Poignée", fournisseur: "", unite: "u", prix_ht: 4, longueur_mm: null, largeur_mm: null, minutes_pose: null },
];

export const CATEGORIES_ARTICLE: { id: Categorie; libelle: string }[] = [
  { id: "panneau", libelle: "Panneaux" },
  { id: "chant", libelle: "Chants" },
  { id: "quincaillerie", libelle: "Quincaillerie" },
  { id: "accessoire", libelle: "Accessoires" },
  { id: "autre", libelle: "Autre" },
];
