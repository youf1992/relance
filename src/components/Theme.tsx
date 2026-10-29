import { useState } from "react";

const CLE = "relance.theme";

function appliquer(sombre: boolean) {
  if (sombre) document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(CLE, sombre ? "dark" : "light");
  } catch {
    /* navigation privée : le choix ne sera pas mémorisé */
  }
}

/** Interrupteur clair / sombre. Clair par défaut. */
export function BoutonTheme(props: { className?: string }) {
  const [sombre, setSombre] = useState(() => document.documentElement.dataset.theme === "dark");
  return (
    <button
      type="button"
      role="switch"
      aria-checked={sombre}
      className={`theme ${props.className ?? ""}`}
      onClick={() => {
        appliquer(!sombre);
        setSombre(!sombre);
      }}
    >
      <span className="theme__piste" aria-hidden />
      Sombre
    </button>
  );
}
