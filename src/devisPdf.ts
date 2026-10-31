// Devis à remettre au client : page imprimable (« Enregistrer en PDF » dans la fenêtre d'impression).
// Le client voit les prix de vente, jamais les coûts d'achat ni la marge.
import type { Chiffrage, Reglages } from "./devis";
import type { Devis } from "./donneesDevis";
import { ajouterJours, dateFr, euros } from "./format";
import type { Client, Entreprise } from "./types";

const h = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const heures = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h`;

export function htmlDevis(d: Devis, c: Chiffrage, r: Reglages, e: Entreprise, client: Client | undefined): string {
  const fournitures = [...new Set(c.materiaux.map((m) => m.libelle))];
  const lignes: [string, string, number][] = [
    [
      "Fournitures",
      fournitures.length ? `Panneaux, chants et quincaillerie : ${fournitures.join(", ")}` : "",
      c.vente_materiaux,
    ],
    ["Fabrication en atelier", `Débit, placage de chants, montage, vérification (${heures(c.heures_fabrication)})`, c.heures_fabrication * r.taux_horaire],
    ["Pose sur site", `Installation chez le client et réglages (${heures(c.heures_pose)})`, c.heures_pose * r.taux_horaire],
  ];
  if (c.transport) lignes.push(["Transport et livraison", "", c.transport]);
  // Arrondi : la dernière ligne absorbe l'écart de centimes pour que la somme = total HT
  const somme = lignes.reduce((s, l) => s + Math.round(l[2] * 100) / 100, 0);
  lignes[lignes.length - 1][2] += Math.round((c.total_ht - somme) * 100) / 100;

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Devis ${h(d.numero)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font: 11pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c1c1c; margin: 0; }
  .haut { display: flex; justify-content: space-between; gap: 2rem; margin-bottom: 2rem; }
  h1 { font-size: 20pt; margin: 0 0 .3rem; }
  .petit { font-size: 9.5pt; color: #555; }
  .boite { border: 1px solid #ccc; border-radius: 6px; padding: .8rem 1rem; min-width: 45%; }
  table { width: 100%; border-collapse: collapse; margin: 1.2rem 0; }
  th, td { text-align: left; padding: .55rem .4rem; border-bottom: 1px solid #ddd; vertical-align: top; }
  th { font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #555; }
  td.m, th.m { text-align: right; white-space: nowrap; }
  .totaux { margin-left: auto; width: 45%; }
  .totaux td { border: 0; padding: .25rem .4rem; }
  .totaux tr.fort td { font-weight: 700; font-size: 13pt; border-top: 2px solid #1c1c1c; padding-top: .5rem; }
  .accord { display: flex; gap: 2rem; margin-top: 2rem; }
  .accord div { flex: 1; border: 1px solid #ccc; border-radius: 6px; padding: .8rem 1rem; min-height: 6rem; }
</style></head><body>
<div class="haut">
  <div>
    <h1>${h(e.nom || "Entreprise")}</h1>
    <div class="petit">${[e.email, e.telephone].filter(Boolean).map(h).join(" · ")}</div>
  </div>
  <div class="boite">
    <strong>Devis n° ${h(d.numero)}</strong><br>
    <span class="petit">Date : ${dateFr(d.date)} · Valable jusqu'au ${dateFr(ajouterJours(d.date, r.validite_jours))}</span>
    <div style="margin-top:.6rem"><strong>${h(client?.nom ?? "")}</strong>${client?.email ? `<br><span class="petit">${h(client.email)}</span>` : ""}</div>
  </div>
</div>
${d.titre ? `<h2 style="font-size:14pt;margin:0 0 .4rem">${h(d.titre)}</h2>` : ""}
${d.notes ? `<p style="white-space:pre-wrap;margin:.2rem 0 0">${h(d.notes)}</p>` : ""}
<table>
  <thead><tr><th>Désignation</th><th class="m">Montant HT</th></tr></thead>
  <tbody>
    ${lignes
      .map(([t, det, m]) => `<tr><td><strong>${h(t)}</strong>${det ? `<br><span class="petit">${h(det)}</span>` : ""}</td><td class="m">${euros(m)}</td></tr>`)
      .join("")}
  </tbody>
</table>
<table class="totaux">
  <tr><td>Total HT</td><td class="m">${euros(c.total_ht)}</td></tr>
  <tr><td>TVA ${r.tva_pct.toLocaleString("fr-FR")} %</td><td class="m">${euros(c.tva)}</td></tr>
  <tr class="fort"><td>Total TTC</td><td class="m">${euros(c.total_ttc)}</td></tr>
</table>
${r.conditions ? `<p class="petit" style="white-space:pre-wrap">${h(r.conditions)}</p>` : ""}
<div class="accord">
  <div><strong>Bon pour accord</strong><br><span class="petit">Date, signature et mention « Bon pour accord »</span></div>
  <div><strong>${h(e.nom)}</strong>${e.signature ? `<br><span class="petit" style="white-space:pre-wrap">${h(e.signature)}</span>` : ""}</div>
</div>
</body></html>`;
}

/** Ouvre le devis dans une nouvelle fenêtre et lance l'impression (choisir « Enregistrer en PDF »). */
export function imprimerDevis(f: Window | null, html: string) {
  if (!f) throw new Error("Autorisez les fenêtres pop-up pour ce site, puis réessayez.");
  f.document.open();
  f.document.write(html);
  f.document.close();
  f.focus();
  setTimeout(() => f.print(), 300);
}
