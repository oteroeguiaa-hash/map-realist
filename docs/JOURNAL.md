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

## 26/11/2026 — Démo web : vrais troncs, couleurs naturelles, physique du buggy

- Grands arbres : le modèle scanné sert de pied (contreforts, 2,8 m), puis un fût d'écorce monte jusqu'à la couronne à 14–18 m (avant : « piliers de roche » de 7 m).
- Couleurs moins « dessin animé » : feuilles moins saturées et moins brillantes, lumière d'ambiance réduite (ombres plus profondes), étalonnage photo, netteté adaptative.
- Fondu entre arbres proches et lointains raccourci : moins de motif tramé.
- Buggy : boîte automatique 5 vitesses + marche arrière, courbe de couple, pneus à modèle de Pacejka (angle de dérive), adhérence selon la charge, cercle d'adhérence (dérapages au gaz), barres anti-roulis, amortisseurs compression/détente, frein moteur, Ackermann, traînée réaliste. Test : 0–80 km/h en ~4,5 s, stable.
- Son : crissement des pneus qui glissent, bruits de pas (sable, feuilles, eau). Champ de vision qui s'élargit avec la vitesse.

## 26/11/2026 — Démo web : route de terre, abattage d'arbres, construction

- Route de terre rendue en vrai : bande de terre battue (texture Farm Soil) avec ornières, bords fondus dans l'herbe, sur toute la boucle de l'île et ses embranchements, plus une nouvelle route qui part de la plage de départ.
- Abattage : 3 coups pour un petit arbre, 8 pour un grand. L'arbre craque, bascule autour de sa charnière sous la gravité (pendule inversé), rebondit, projette poussière et feuilles, puis reste couché. La souche reste. Le tronc couché devient un obstacle.
- Bois récolté (3 ou 8 bûches) ; construction en rondins : mur (6), plancher (8), rampe à buggy (10). Les pièces s'alignent sur une grille, portent le joueur et le buggy.
- Sauvegarde dans le téléphone (localStorage) : arbres abattus, bois, constructions retrouvés au retour.
- Testé (Chromium logiciel) : chute d'un arbre de 22 m (repos à 88°), pose des trois pièces, route visible, conduite stable.

## 26/11/2026 — Démo web : palmiers variés, branches au vent, jungle dense au bord des routes

- Palmiers orientés au hasard (seuls ceux du bord de mer penchent plutôt vers l'eau) ; troncs de palmiers 1,5× plus épais, grands arbres plus larges.
- Vent : chaque palme et branche oscille avec son propre rythme, d'autant plus qu'elle est loin du tronc.
- Bordure de végétation dense et nette le long des routes (bananiers, monstera, fougères), sous-bois plus fourni partout, herbe plus verte.
- Mesure (Chromium logiciel, Moyen, jungle vue d'en haut) : 1,69 M triangles ombres comprises.

## 26/11/2026 — Démo web : nouveau décor Poly Haven et éclairage « stream »

- Gardés : arbres (palmiers, grands arbres, jeunes palmiers), animaux, buggy, avion, outils, ponton, piste, routes, constructions.
- Supprimés : anciens rochers et falaises, coquillages, bois flotté, petites plantes (monstera, bananiers, fougères du pack), ancienne carte d'éclairage.
- Nouveau sous-bois : fougères fern_02, touffes grass_medium_01, othonna (côte, volcan), racines root_cluster_01. Nouveaux rochers : boulder_01, namaqualand_boulder_02/05, rock_moss_set_02 (2 à 5 m), parois namaqualand_cliff_01 et rock_face_02 sur les pentes et autour de la cascade, mountainside sur le volcan, galets sand_rocks_small_01 sur les plages, troncs dead_tree_trunk_02.
- Éclairage d'environnement : stream_2k.exr (EXRLoader), tourné pour que son soleil coïncide avec celui du jeu. Le ciel visible reste le ciel physique (la photo montre une vallée boisée, pas un horizon marin).
- Mesure (Chromium logiciel, Moyen, jungle vue d'en haut) : 1,84 M triangles ombres comprises. Téléchargement total : 40 Mo.

## 26/11/2026 — Démo web : relief, herbe partout, animaux ×10, nuages nets

- Grands arbres : un seul fût d'écorce continu du sol à la couronne, évasé avec des contreforts (le pied scanné jungle_tree, qui faisait des cassures, est retiré).
- Netteté : résolution jamais sous 72 % (on baisse la qualité plutôt que la résolution), feuilles anticrénelées (alpha-to-coverage), couleurs moins saturées.
- Nuages : cubemap plus fine (384 px en Moyen, 512 en Élevé), plus blancs et plus opaques. Essai d'accumulation temporelle abandonné (ciel assombri).
- Relief cuit dans les hauteurs : dunes et bosses sur le sable, buttes dans l'herbe et sous la jungle (routes, piste, départ et bassin restent plats). Buggy, joueur et plantes suivent ce relief.
- Touffes d'herbe (grass_medium_01) et fougères partout autour du joueur, penchées vers le bas des pentes ; le vent couche les petites plantes.
- Animaux : environ 330 (tigres 14, jaguars 14, sangliers 30, singes 60, crabes 40, oiseaux 84…), avec leurs cris synthétisés (singes, perroquets, mouettes, tigre, sanglier, crocodile, sifflements), placés à gauche/droite selon leur position.
- Mesure (Chromium logiciel, Moyen, jungle vue d'en haut) : 1,65 M triangles ombres comprises, 171 appels de dessin ; ~420 appels près du départ (animaux).

## 26/11/2026 — Démo web : campement éclairé, lampe, jumelles, étangs, chocs du buggy

- Fluidité : les animaux ne sont plus tous affichés ; ~150 animaux sont recyclés autour du joueur (ceux qui sont loin réapparaissent hors de vue). Les modèles sans squelette sont fusionnés par matériau (crabes : 30 appels de dessin → 1). Départ en Moyen : 973 → 258 appels.
- Relief : petites cuvettes irrégulières ici et là. Criques rocheuses : rochers et galets sur le sable, crabes regroupés autour.
- Étangs de jungle creusés dans le relief (7), eau ambrée/thé qui fonce avec la profondeur, petites vagues, découpée par le sol (ne dépasse jamais) ; groupes de 4 crocodiles.
- Buggy : arrêt net contre un gros arbre avec légère déformation de la caisse, l'arbre oscille ; petits arbres arrachés, fougères/buissons écrasés, animaux projetés.
- Campement près du départ : 18 barrières en béton (collisions, animaux interdits), 2 appliques murales sur poteaux, projecteur 20 000 lm sur trépied avec faisceau volumétrique, table et bougeoir (flamme qui vacille). Ombres pour toutes ces lumières (sauf qualité Basse), mises à jour périodiquement.
- Lampe torche (1000 lm, faisceau réglable 6–45°, faisceau volumétrique doux) et jumelles (zoom 1× à 20×, masque à deux optiques, visée plus fine) à ramasser sur la table du campement.
- Les 6 accessoires gardent 100 % de leurs triangles (bougeoir : 213 000 ; barrière : 24 000 chacune) ; le campement n'est affiché qu'à moins de 90 m.
- Mesure (Chromium logiciel, Moyen, départ) : 1,98 M triangles, 258 appels de dessin.
- Pas encore fait : vagues et écume sur la mer, vrai monde sous-marin.

## 26/11/2026 — Démo web : correctif « sol disparu » sur iPhone, vagues, démarrage

- Bug : sur iPhone le sol ne s'affichait plus (on ne voyait que la mer). Cause : les ombres des lampes du campement ajoutaient des textures à tous les matériaux ; le shader du sol dépassait la limite de 16 textures de l'iPhone et ne compilait plus. Correctif : ombres des lampes seulement si la carte graphique accepte au moins 24 textures (ordinateur, qualité Élevée/Ultra) ; une texture de moins dans le sol (les cendres réutilisent la roche). Test automatique ajouté (`node tools/test.mjs samplers`) : 16 au maximum en qualité Moyenne.
- Démarrage : tous les shaders sont compilés pendant l'écran de chargement, et on attend les animaux avant de lancer (moins de saccades au début).
- Mer : vagues plus hautes, rouleaux qui arrivent vers la plage et se creusent quand le fond remonte ; écume fine sur la crête des rouleaux et moutons au large par vent fort.
- Test de qualité forcée : `?q=0..3` dans l'adresse.
