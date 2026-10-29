import { useEffect, useState } from "react";

/** Efface la session enregistrée dans ce navigateur (sans toucher aux autres réglages). */
function reinitialiser() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("sb-")) localStorage.removeItem(k);
  } catch {
    /* stockage indisponible */
  }
  window.location.reload();
}

/**
 * Écran de chargement. S'il dure trop (session bloquée, réseau coupé…), on propose
 * de réessayer ou de réinitialiser la connexion, au lieu de rester sur une page blanche.
 */
export function Chargement() {
  const [lent, setLent] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLent(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="vide">
      <p className="discret">Chargement…</p>
      {lent && (
        <>
          <p>Le chargement prend plus de temps que prévu.</p>
          <div className="rangee" style={{ justifyContent: "center" }}>
            <button className="bouton" onClick={() => window.location.reload()}>
              Réessayer
            </button>
            <button className="bouton bouton--secondaire" onClick={reinitialiser}>
              Réinitialiser la connexion
            </button>
          </div>
          <p className="discret petit">« Réinitialiser » vous déconnecte de ce navigateur : il suffira de vous reconnecter.</p>
        </>
      )}
    </div>
  );
}
