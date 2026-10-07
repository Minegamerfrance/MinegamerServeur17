# MNG FUT 20 — 1.8.38

- Nouvelle affiche OTW fournie par le joueur, sans Frosty et avec une nouvelle URL pour éviter l'ancien cache.
- Groupe Ones To Watch ajouté aux objectifs de saison : huit défis, aperçu Ndombele OTW 81 invendable, récompense de groupe persistante et unique.
- Conditions auparavant Rivals décrites comme Rivals ou Clash d'équipes. Cette version ne réactive pas le mode Rivals local désactivé.
- Summer Moves et Parisian Talent : suivi des victoires Clash d'équipes à partir des titulaires enregistrés au début du match, avec difficulté Champion minimum pour Summer Moves.
- Capture du dernier rapport de match hors ligne dans runtime/objective-reports pour vérifier les statistiques natives, sans modifier l'accusé de réception de fin de match.
- Pass de 40 niveaux et progression existante conservés.

## Limites connues — intégration en cours

Les six défis portant sur les buts et passes ne progressent pas encore automatiquement. Le comptage précis des buts en finesse, sur centre, par championnat et des passes doit être relié aux données d'un match réel. Les récompenses annexes des captures (packs, maillot OTW et style Ombre) ne sont pas encore intégrées : chaque défi expose actuellement 100 XP. Ndombele ne peut pas être gagné naturellement tant que le suivi des huit défis n'est pas terminé ; aucune condition manquante n'est validée artificiellement.

Tests automatisés réussis : groupe et aperçu natifs, seuils des deux défis de victoire, conditions inconnues non créditées, récupération unique en concurrence sur base de test, capture du rapport préservant la réponse native, pass de saison et affiche de chargement. Validation en jeu encore requise.
