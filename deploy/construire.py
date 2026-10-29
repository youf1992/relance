#!/usr/bin/env python3
"""Génère deploy/relance-installer.sh (le SQL des migrations y est copié)."""
import glob, os
ici = os.path.dirname(os.path.abspath(__file__))
t = open(os.path.join(ici, "relance-installer.template.sh")).read()
sql = "".join(open(f).read() for f in sorted(glob.glob(os.path.join(ici, "..", "supabase", "migrations", "*.sql"))))
open(os.path.join(ici, "relance-installer.sh"), "w").write(t.replace("__SQL__", sql.rstrip()))
print("deploy/relance-installer.sh généré")
