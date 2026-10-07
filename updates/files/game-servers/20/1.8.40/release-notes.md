# FIFA 20 — 1.8.40

## Test temporaire de la vraie demande de mise à jour FUT

- Test demandé explicitement : présenter la demande native avant d'intégrer des effectifs personnalisés.
- Le serveur annonce une version FUT de diagnostic via le manifeste `/roster`, sans changer les versions des effectifs classiques ni les identifiants de schéma.
- Ce n'est pas une vraie mise à jour. Ne pas appuyer sur OK : aucun fichier d'effectifs n'est fourni. Les demandes de téléchargement reçoivent une réponse HTTP 410 vide, jamais un faux fichier qui pourrait être enregistré.
- Utiliser Retour pour quitter la demande. Pour retrouver l'entrée FUT normale, fermer puis relancer le serveur ET le jeu. Le test se désactive automatiquement après la première session où le manifeste a été demandé.
- Le marqueur local `runtime/data/roster-popup-test-1.8.40.done` conserve cette désactivation. Il n'est pas inclus dans le paquet distribué. Sa suppression manuelle, serveur arrêté, permet de réarmer le test.
- Tests serveur réussis : champs XML, réponses concurrentes, conservation du manifeste original et des en-têtes de session, refus de téléchargement, désactivation au redémarrage et repli si le marqueur n'est pas inscriptible.
- L'affichage réel dans cette édition de FIFA 20 reste à vérifier en jeu. Aucun exécutable, DLL ni fichier Frosty n'a été modifié.

## Ndombele OTW

- Portrait dynamique fourni par l'utilisateur ajouté à la carte OTW 81 (`352557105`), sans remplacer le portrait de sa carte de base.
- Portrait DDS et réponse du serveur validés. Note, statistiques, rareté et conditions d'obtention inchangées.

Les huit récompenses OTW et leurs traductions de la version 1.8.39 restent présentes. Le suivi détaillé des buts et passes des six objectifs concernés reste à finaliser.
