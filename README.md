# Relance

Relance des factures impayées pour les TPE / indépendants (France).

- **Aujourd'hui** : les relances à envoyer, en un clic. Le mail s'ouvre dans la messagerie de l'utilisateur,
  déjà rempli (client, montant, échéance, IBAN / lien de paiement) : il part de sa propre adresse, gratuit.
- **Factures** : saisie rapide ou import CSV (export Excel / outil de facturation), statuts payée / litige / pause.
- **Clients**, **Mails de relance** (scénario J+3 / J+10 / J+20 modifiable), **Mon entreprise**.

- **Dépenses** (pré-compta) : factures fournisseurs en PDF lues automatiquement (fournisseur, HT, TVA, TTC, catégorie),
  photos de tickets, justificatifs rangés ; **export du mois** pour le comptable (CSV + justificatifs en ZIP).
- **Banque** : import du relevé CSV ; sorties sans justificatif = pièces manquantes ; entrées au montant d'une facture
  à encaisser = « payée » en un clic (les relances s'arrêtent).

- **Devis** (menuiserie / agencement sur mesure) : catalogue de prix (panneaux, chants ABS, quincaillerie, accessoires),
  temps standards (sciage, chants, montage, vérification, nettoyage, pose), difficulté, chute, marge, TVA.
  Calcul détaillé (interne) + devis PDF client ; devis accepté → facture en un clic (les relances prennent le relais) ;
  temps réel noté après chantier pour corriger les temps standards.
  **Lecture de plan** (PDF/photo, envoyé en image) par OpenRouter (modèles gratuits possibles) ou Google Gemini :
  propose les pièces et accessoires, l'artisan vérifie.
  Clé côté serveur, limite de plans par entreprise et par mois (`relance.ia_usage`).

Plus tard : envoi automatique (boîte mail branchée).

## Technique

- React + Vite + TypeScript, hébergé sur Cloudflare (Workers, fichiers statiques), `wrangler.jsonc`.
- Supabase partagé (celui de Podo) : schéma `relance`, sécurité RLS (chaque compte ne voit que ses lignes),
  comptes partagés (`auth.users`, inscriptions marquées `app: relance`), anti-robot Turnstile.
- Mise en place sur le VPS : `sh deploy/relance-installer.sh https://<adresse-de-l-app>` (rejouable).
  Le script est généré par `python3 deploy/construire.py` à partir de `supabase/migrations/`.
- Lecture des plans : `sh deploy/relance-plans.sh <clé OpenRouter sk-or-… ou Gemini AIza…>` (`MODELE=…`) (options `PLANS_PAR_MOIS`, `GEMINI_MODELE`, `--retirer`).

```bash
npm install
npm run dev
```
