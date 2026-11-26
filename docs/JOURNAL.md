# Journal de construction

Une entrée par session : ce qui a été fait, captures, performances mesurées, problèmes, prochaine étape.

## 26/11/2026 — Préparation

- Cahier des charges écrit : `docs/GAME_DESIGN.md`.
- Guide d'installation écrit : `docs/INSTALLATION_PC.md`.
- Règles de travail pour Claude : `CLAUDE.md`.
- Aucun projet Unreal encore : il faut d'abord installer Unreal Engine 5.8, Claude Code et le pont MCP sur la MSI Claw A1M (ou un futur PC).
- **Prochaine étape :** installation (`docs/INSTALLATION_PC.md`), puis jalon 0.

## 26/11/2026 — Démo web jouable sur iPhone

- Démo three.js dans `web/` : île de 2 km avec volcan, cascade, lagon, récif, ciel et nuages volumétriques, heure et météo réglables.
- 100 types d'arbres et de palmiers + 100 types de buissons ; environ 28 700 arbres et 128 000 buissons placés.
- Buggy jouable (joystick tactile), traces de pneus dans le sable, avion de brousse, hydravion, poissons et coraux.
- Textures et objets scannés gratuits (Poly Haven, CC0).
- Testé dans Chromium (rendu logiciel) : chargement sans erreur. Fluidité sur iPhone à vérifier par le joueur (résolution adaptée automatiquement).
- **Prochaine étape :** retours du joueur sur la démo ; installation d'Unreal pour la version complète.

## 26/11/2026 — Démo web : modèles 3D du joueur, personnage à pied, faune

- Les 24 modèles .glb du dépôt `ile-3d` remplacent les objets générés : palmiers, plantes de jungle, monstera, troncs géants, rochers, buggy, avion, hache, rivelaine et 15 espèces d'animaux.
- Ils sont allégés de 150 Mo à 12,5 Mo (textures WebP, maillages simplifiés, compression meshopt) et chargés en parallèle ; un modèle trop lent est ignoré (version générée de secours), donc jamais d'écran noir.
- Nouveau : personnage à pied en vue subjective (marche, course, saut, nage, plongée), buggy optionnel garé devant soi, hache et rivelaine à ramasser sur la plage, frappe sur les arbres.
- Animaux : patrouilles au sol (tigre, jaguar, sanglier, varan, python, singe, crabe), crocodile dans le bassin de la cascade, tortue, banc de poissons et requin dans l'eau, mouettes en vol, perroquets et aracari perchés dans les palmiers. Ils fuient quand on s'approche.
- Panneau « Crédits des modèles 3D » (obligatoire pour les licences CC-BY).
- Mesures (Chromium, rendu logiciel, qualité Moyen) : 1,1 M triangles à la plage, 1,45 M dans la jungle la plus dense (ombres comprises), 120 à 200 appels de dessin. Fluidité réelle sur iPhone à vérifier par le joueur.
- **Prochaine étape :** retours du joueur sur iPhone ; brume et rayons de soleil dans la jungle.

## 26/11/2026 — Démo web : nettoyage et chaîne d'effets officielle three.js

- Supprimé : arbres et buissons générés par code (seulement en secours si un modèle ne charge pas), herbe en brins, gros blocs de falaise étirés. Rochers limités à 2–5 m.
- Feuilles : alphaTest 0,5, pas de transparence, écriture de profondeur, double face ; couleur étendue sous les zones transparentes des textures (fin des liserés noirs).
- Rendu : EffectComposer → RenderPass → étalonnage → UnrealBloomPass (0,25 / 0,6 / 0,85) → OutputPass (ACES Filmic, exposition 1,15).
- Lumière : HemisphereLight #87ceeb / #6b5e45, soleil doré #fff2d6, biais d'ombre −0,0005, éclairage d'ambiance par la photo HDR « Rainforest Trail » (Poly Haven) le jour.
- Sol : terre « Farm Soil » (pistes et plaques sous la jungle), galets « Dry River Pebbles » (rives, bassin, criques), roche « Dark Rock 02 » en projection triplanaire complète.
- Mesures (Chromium logiciel, Élevé) : 0,8 M triangles à la plage, 1,45 M dans la jungle.
