# MNG FUT 1.3.10

Le manifeste Windows du lanceur exige désormais `requireAdministrator`.
Un double-clic déclenche automatiquement la confirmation UAC : aucun clic droit
« Exécuter en tant qu’administrateur » ni réglage de compatibilité nécessaire.
Si la confirmation est refusée, Windows ne démarre pas le lanceur.
L’UAC et les protections Windows restent activées.

La modification permet aux processus serveur démarrés par le lanceur
d’hériter des droits administrateur. Elle ne garantit pas la résolution
d’un refus provenant d’une autre protection ou d’un verrou sur le fichier hosts.

Les entrées existantes, le logo FIFA 21, les réglages et les sauvegardes
sont conservés. Le serveur FIFA 21 reste en préparation.

Contrôles : syntaxe et tests du lanceur, chargement WPF sans affichage,
présence de `requireAdministrator` dans l’exécutable compilé, intégrité
du paquet et signature avec la clé publique déjà utilisée par MNG FUT.
