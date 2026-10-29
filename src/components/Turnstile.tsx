import { useEffect, useRef } from "react";

// Cloudflare Turnstile : vérification anti-robot (souvent invisible pour l'utilisateur).
// La clé du site est publique ; la clé secrète reste sur le serveur d'authentification.

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let chargement: Promise<void> | null = null;

function chargerScript() {
  if (window.turnstile) return Promise.resolve();
  if (!chargement) {
    chargement = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        chargement = null;
        reject(new Error("Turnstile indisponible"));
      };
      document.head.appendChild(s);
    });
  }
  return chargement;
}

/**
 * Affiche le contrôle anti-robot. `onJeton` reçoit le jeton (ou null s'il expire).
 * Changer `version` force un nouveau contrôle (un jeton ne sert qu'une fois).
 */
export function Turnstile(props: { cleSite: string; version: number; onJeton: (j: string | null) => void }) {
  const zone = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);
  const rappel = useRef(props.onJeton);
  rappel.current = props.onJeton;

  useEffect(() => {
    let annule = false;
    chargerScript()
      .then(() => {
        if (annule || !zone.current || !window.turnstile) return;
        const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        id.current = window.turnstile.render(zone.current, {
          sitekey: props.cleSite,
          language: "fr",
          theme,
          callback: (j: string) => rappel.current(j),
          "expired-callback": () => rappel.current(null),
          "error-callback": () => rappel.current(null),
        });
      })
      .catch(() => rappel.current(null));
    return () => {
      annule = true;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
  }, [props.cleSite]);

  useEffect(() => {
    if (props.version > 0 && id.current && window.turnstile) {
      rappel.current(null);
      window.turnstile.reset(id.current);
    }
  }, [props.version]);

  return <div ref={zone} className="turnstile" />;
}
