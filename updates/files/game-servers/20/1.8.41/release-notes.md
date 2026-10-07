# FIFA 20 — 1.8.41

## Diagnostic de la demande native de mise à jour FUT

La session réelle du 7 octobre à 22 h 32 reçoit bien le manifeste de diagnostic de la version 1.8.40, mais entre dans FUT sans afficher la demande. Ce n'est donc pas un problème d'activation du test ni un manifeste resté en cache.

L'inspection en lecture seule du jeu en cours identifie la base native par `366c98dae36dac79a6feec3e3e29e42aa94492b4`. Cet identifiant ne correspond à aucune des deux entrées du manifeste historique. Les champs de mise à jour FUT du jeu restent à -1. L'analyse du lecteur XML natif confirme qu'il ne renseigne la version FUT que pour une entrée correspondant à son identifiant de base.

- Ajout d'une entrée `pc64` de diagnostic correspondant à l'identifiant réellement observé. Les deux entrées historiques restent inchangées.
- Réarmement du test pour une session avec un nouveau marqueur `runtime/data/roster-popup-test-1.8.41.done`.
- Toujours aucune donnée d'effectifs téléchargée, ni modification des sauvegardes, de la base de joueurs, des DLL, de l'exécutable ou des fichiers Frosty.
- Si la demande apparaît, utiliser Retour, pas OK. Un téléchargement demandé reste refusé par une réponse HTTP 410 vide.
- Fermer et relancer le serveur ET le jeu après cette session restaure le manifeste normal. Aucun ancien marqueur n'est supprimé.
- Portrait dynamique de Ndombele OTW conservé, confirmé en jeu par l'utilisateur.

Tests serveur : correspondance de l'identifiant observé, conservation des entrées et effectifs de base, réponses concurrentes, refus de téléchargement, désactivation au redémarrage et repli en cas de marqueur non inscriptible. L'affichage de la fenêtre avec ce nouveau manifeste reste à confirmer en jeu ; il ne s'agit pas encore d'une vraie mise à jour d'effectifs.
