# Instructions pour Claude — Map Realist

## Le joueur

- Parle-lui en **français**, simplement : il n'est pas développeur.
- Il suit souvent la session depuis son **iPhone** : messages courts, une question à la fois, pas de pavés techniques.
- Il veut un résultat **ultra réaliste**. Sois franc quand une demande dépasse ce que sa machine peut faire, et propose la meilleure alternative.

## Avant de travailler

1. Lis `docs/GAME_DESIGN.md` en entier : c'est le cahier des charges, il fait foi.
2. Lis `docs/JOURNAL.md` pour savoir où on en est.
3. Vérifie que le serveur MCP d'Unreal est connecté (`/mcp`). S'il ne l'est pas, ne fais pas semblant : dis-le et aide à le relancer (`docs/INSTALLATION_PC.md`, étape 5).

## Méthode

- **Un jalon à la fois** (`docs/GAME_DESIGN.md` §18). Ne commence pas le suivant sans la validation du joueur.
- Tout ce qui construit le monde passe par des **scripts Python d'éditeur** rangés dans `MapRealist/Content/Python/`, pour que le monde puisse être reconstruit et retouché par script. Le code de gameplay (buggy, avions, traces) est en **C++** dans `MapRealist/Source/`.
- **Vérifie en regardant.** Après chaque étape visible, prends des captures depuis les points de vue de référence (`HighResShot`, fichiers dans `MapRealist/Saved/Screenshots/`), regarde-les toi-même et compare-les aux interdits du §2 avant de dire que c'est fait.
- **Ne déclare jamais une chose terminée sans preuve** : capture, mesure de fps ou test en jeu.
- **Mesure les performances** à chaque jalon (`stat unit`, `stat gpu`) et note-les dans `docs/JOURNAL.md`.
- Un seul agent pilote l'éditeur Unreal à la fois. Pas d'agents en parallèle sur le même éditeur.

## Machine actuelle

- **MSI Claw A1M** : Intel Core Ultra, graphismes Intel Arc intégrés, 16 Go de RAM.
- La mémoire est juste : ferme les onglets d'éditeur inutiles, n'enchaîne pas plusieurs compilations lourdes en parallèle, charge le monde par zones (World Partition).
- Réglages de travail : préréglage Bas ou Moyen, Lumen Lite, XeSS. Les captures « qualité finale » se feront sur une machine plus puissante.

## Git

- Commits petits et fréquents, messages en français. Pousse à la fin de chaque jalon.
- Ne versionne jamais `Binaries/`, `Intermediate/`, `Saved/` ni `DerivedDataCache/` (déjà dans `.gitignore`).
- Les `.uasset` et `.umap` passent par **Git LFS** (`.gitattributes`). Le quota LFS gratuit de GitHub est limité : surveille la taille.
- Les **packs d'assets téléchargés** (Fab, Megascans…) ne sont **jamais** versionnés (licence et taille) : importe-les dans `Content/Fab/`, `Content/Megascans/` ou `Content/ThirdParty/` (ignorés par Git) et liste-les dans `docs/ASSETS.md` pour pouvoir les retélécharger.

## Dépenses

- N'achète rien et ne télécharge aucun asset payant sans l'accord explicite du joueur.
