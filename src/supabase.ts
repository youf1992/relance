import { createClient } from "@supabase/supabase-js";

// Valeurs PUBLIQUES (visibles dans le navigateur de toute façon).
// Ne jamais mettre ici la clé service_role / secret.
const URL_PAR_DEFAUT = "https://podo-api-37-60-238-12.sslip.io";
const CLE_PAR_DEFAUT = "sb_publishable_Y-69jsHZpMMAsaRoiIiLKF_9LrcYzgH";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || URL_PAR_DEFAUT;
const cle = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || CLE_PAR_DEFAUT;

/** Clé de site Cloudflare Turnstile (publique). Vide = pas de contrôle anti-robot. */
export const CLE_TURNSTILE =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || "0x4AAAAAAFlM_0YXUjXL1p49";

// Le serveur est partagé avec d'autres apps : nos tables sont dans le schéma « relance ».
export const supabase = createClient(url, cle, { db: { schema: "relance" } });
