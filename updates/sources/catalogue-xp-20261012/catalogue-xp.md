# XP du catalogue EAS FC — serveur 1.8.89

Le barème local n'est pas une reproduction des montants historiques d'EA :

- 100 XP par match FUT terminé et enregistré ; 50 XP supplémentaires pour une victoire.
- 100 XP par rapport natif de match terminé, y compris hors FUT, reçu par le serveur connecté. Une victoire hors FUT ne reçoit pas de bonus tant que son résultat individuel n'est pas décodé.
- 1 000 XP par niveau, à partir du niveau 1.

L'XP du catalogue est indépendante du pass FUT. Les niveaux débloquent les récompenses existantes ; celles-ci restent gratuites et doivent être récupérées dans le catalogue.

Le profil et les événements crédités sont conservés dans la base locale. L'ancien profil `runtime/data/easfc-profile.json` est repris sans être écrasé. Les récompenses déjà réclamées et les sauvegardes sont inchangées. Les rapports natifs et FUT qui portent le même identifiant sont fusionnés : seule la différence éventuelle du bonus de victoire est ajoutée.

Les rapports natifs doivent fournir GRID positif, GTYP et FNSH=1 (FINISHED). Un accusé contenant seulement GRID, un rapport abandonné ou un rapport sans preuve de fin de match ne donne pas d'XP. Le serveur conserve sa réponse native et journalise les rapports non reconnus. Un mode entièrement hors connexion qui n'envoie aucun rapport ne peut pas être crédité par le serveur.

La prise en charge native nécessite un essai réel : terminer un match hors FUT avec le serveur actif, revenir au catalogue et vérifier le compteur. Les tests synthétiques vérifient le traitement, pas l'émission de rapports par chaque mode FIFA 20.
