# Lewandowski Flashback 85: gestes techniques

Version serveur 1.8.93, distribuée par le mécanisme de mise à jour signé du lanceur.

Le client lit les gestes techniques depuis sa bibliothèque de cartes, puis utilise
les données du joueur de base. Le correctif cible uniquement la ressource FUT
537059457: valeur native 2, affichée comme 3 étoiles. Le mauvais pied reste à
4 étoiles; la carte Or, les autres versions et les autres joueurs restent inchangés.
Aucun joueur supplémentaire n'est créé.

L'installation utilise le dossier FIFA déjà configuré pour le correctif catalogue.
Elle refuse les bibliothèques inconnues ou altérées, sauvegarde l'original dans
`runtime/data/native-flashback-backups`, vérifie les empreintes avant et après
installation et attend le prochain démarrage du serveur avec FIFA fermé si le jeu
est en cours. Les options de lancement restent inchangées.

Le paquet contient uniquement les modifications binaires et l'installateur, pas la
bibliothèque complète du jeu. L'image modifiée n'est plus signée par EA; aucun
contournement de signature ou de protection n'est effectué.

Les instructions x64 ont été exécutées dans un processus de test isolé: la carte
cible reçoit 3 GT, le mauvais pied et les autres cartes restent identiques, les deux
branches d'origine sont conservées. Les tests d'installation couvrent sauvegarde,
idempotence, fichier inconnu, corruption et report pendant l'exécution de FIFA.
La validation du résultat dans FIFA reste nécessaire.
