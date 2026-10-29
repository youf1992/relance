# Relance

Relance des factures impayées pour les TPE / indépendants (France).

- **Aujourd'hui** : les relances à envoyer, en un clic. Le mail s'ouvre dans la messagerie de l'utilisateur,
  déjà rempli (client, montant, échéance, IBAN / lien de paiement) : il part de sa propre adresse, gratuit.
- **Factures** : saisie rapide ou import CSV (export Excel / outil de facturation), statuts payée / litige / pause.
- **Clients**, **Mails de relance** (scénario J+3 / J+10 / J+20 modifiable), **Mon entreprise**.

Plus tard : envoi automatique (boîte mail branchée), pré-compta (lecture des factures fournisseurs, export comptable).

## Technique

- React + Vite + TypeScript, hébergé sur Cloudflare (Workers, fichiers statiques), `wrangler.jsonc`.
- Supabase partagé (celui de Podo) : schéma `relance`, sécurité RLS (chaque compte ne voit que ses lignes),
  comptes partagés (`auth.users`, inscriptions marquées `app: relance`), anti-robot Turnstile.
- Mise en place sur le VPS : `sh deploy/relance-installer.sh https://<adresse-de-l-app>` (rejouable).
  Le script est généré par `python3 deploy/construire.py` à partir de `supabase/migrations/`.

```bash
npm install
npm run dev
```
