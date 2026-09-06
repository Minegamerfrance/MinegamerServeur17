# MNG FUT – Dynamic Player Images

Ce dépôt sert **uniquement aux images dynamiques des joueurs de cartes spéciales**.

## Frosty reste responsable de

- visuel / frame / design de carte ;
- couleurs / raretés graphiques ;
- portraits normaux des joueurs ;
- ressources normales du jeu.

## GitHub sert uniquement

Les portraits dynamiques déclarés explicitement dans `database.json`.

La correspondance est faite avec le **resourceId exact de la carte spéciale**.

```text
John Terry normal (assetId 13732)
→ FIFA / Frosty

John Terry Flashback (resourceId 134231460)
→ GitHub
```

Aucun `assetId` normal n'est utilisé comme alias en ligne.

## Ajouter une image

1. Ajouter `images/RESOURCEID.png` et/ou `images/RESOURCEID.dds`.
2. Ajouter/modifier l'entrée correspondante dans `database.json`.
3. `enabled` doit être `true`.
4. Commit sur GitHub.
5. Sur le serveur MNG : `SYNCHRONISER-IMAGES-GITHUB.bat`.

Le serveur conserve ensuite les fichiers dans son cache local.

## Mises à jour du lanceur

Le dossier `updates` contient le manifeste utilisé par MNG FUT Launcher. La version `1.0.1` installe uniquement un fichier témoin afin de valider le téléchargement, le contrôle SHA-256, la sauvegarde et l'installation sans modifier FIFA ni Frosty.
