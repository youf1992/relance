import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Après une mise à jour du site, une page restée ouverte peut demander un fichier qui
// n'existe plus : on recharge une fois pour récupérer la nouvelle version.
window.addEventListener("vite:preloadError", (e) => {
  try {
    if (sessionStorage.getItem("recharge-maj")) return;
    sessionStorage.setItem("recharge-maj", "1");
  } catch {
    /* stockage indisponible */
  }
  e.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => {
  setTimeout(() => {
    try {
      sessionStorage.removeItem("recharge-maj");
    } catch {
      /* rien */
    }
  }, 10_000);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
