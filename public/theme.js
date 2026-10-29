// Applique le thème choisi avant l'affichage (évite un flash blanc en mode sombre).
try {
  if (localStorage.getItem("relance.theme") === "dark") document.documentElement.dataset.theme = "dark";
} catch (e) {}
