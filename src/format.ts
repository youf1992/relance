export const euros = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }).replace(/ | /g, " ");

export const dateFr = (iso: string | null | undefined) => {
  if (!iso) return "";
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
};

/** Date du jour au format AAAA-MM-JJ (heure locale). */
export const aujourdhui = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const ajouterJours = (iso: string, jours: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + jours);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Nombre de jours de b à a (a - b), dates AAAA-MM-JJ. */
export const ecartJours = (a: string, b: string) =>
  Math.round((new Date(`${a}T12:00:00`).getTime() - new Date(`${b}T12:00:00`).getTime()) / 86_400_000);

/** « 1 234,56 », « 1234.56 », « 1 234,56 € » → 1234.56 ; null si illisible. */
export function lireMontant(s: string): number | null {
  const propre = s.replace(/[\s  €]/g, "").replace(/[^\d,.-]/g, "");
  if (!propre) return null;
  // la dernière virgule ou le dernier point est le séparateur décimal
  const i = Math.max(propre.lastIndexOf(","), propre.lastIndexOf("."));
  const n =
    i >= 0 && propre.length - i - 1 <= 2
      ? Number(propre.slice(0, i).replace(/[,.]/g, "") + "." + propre.slice(i + 1))
      : Number(propre.replace(/[,.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** « 31/12/2026 », « 31-12-26 », « 2026-12-31 » → « 2026-12-31 » ; null si illisible. */
export function lireDate(s: string): string | null {
  const t = s.trim();
  let a: number, m: number, j: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) [a, m, j] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t))) {
    [j, m, a] = [Number(r[1]), Number(r[2]), Number(r[3])];
    if (a < 100) a += 2000;
  } else return null;
  const d = new Date(Date.UTC(a, m - 1, j));
  if (d.getUTCFullYear() !== a || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== j) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(j).padStart(2, "0")}`;
}

export const emailValide = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
