#!/usr/bin/env python3
"""Génère les scripts du VPS à partir des modèles :
- deploy/relance-installer.sh (le SQL des migrations y est copié)
- deploy/relance-ia.sh        (la fonction serveur relance-lire-facture y est copiée)
"""
import glob
import os

ici = os.path.dirname(os.path.abspath(__file__))
lire = lambda *p: open(os.path.join(ici, *p)).read()

sql = "".join(open(f).read() for f in sorted(glob.glob(os.path.join(ici, "..", "supabase", "migrations", "*.sql"))))
assert "\nRELANCE_SQL\n" not in sql
open(os.path.join(ici, "relance-installer.sh"), "w").write(lire("relance-installer.template.sh").replace("__SQL__", sql.rstrip()))
print("deploy/relance-installer.sh généré")

code = lire("..", "supabase", "functions", "relance-lire-facture", "index.ts").rstrip()
assert "\nRELANCE_TS\n" not in code
open(os.path.join(ici, "relance-ia.sh"), "w").write(lire("relance-ia.template.sh").replace("__FONCTION__", code))
print("deploy/relance-ia.sh généré")
