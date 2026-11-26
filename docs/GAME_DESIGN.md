# Map Realist — Cahier des charges

> Document de référence unique du jeu. Chaque session de Claude qui construit le jeu le lit en entier avant de commencer et ne s'en écarte pas sans l'accord du joueur.
> Version 1 — 26 novembre 2026.

## 1. Le concept

Tu apparais sur la plage d'une île tropicale volcanique, à côté d'un buggy. Tu explores librement : jungle très dense, lagune transparente pleine de poissons, cascade, volcan fumant au centre, et des avions à trouver et à piloter.

Le but numéro un : que ce soit **le plus beau et le plus réaliste possible**. Le gameplay vient après.

L'île, son plan, ses véhicules et son nom sont **originaux** : on ne copie aucun jeu existant.

### Ce que le joueur a demandé (liste de contrôle)

- [ ] Rendu jusqu'en **4K**.
- [ ] **Vrai ciel** : vrai soleil, météo qui change, **nuages réalistes en volume** (pas des nuages blancs « dessin animé »).
- [ ] **Lumière et ombres** très travaillées, de vrais shaders.
- [ ] **Textures de haute qualité**, au minimum le niveau de GTA V, rien de « cartoon ».
- [ ] Un **buggy** au point d'apparition.
- [ ] Des **avions** à trouver sur l'île, ultra réalistes.
- [ ] Une **cascade** avec des particules d'eau.
- [ ] **Végétation dense partout** sauf sur la plage, avec **beaucoup de palmiers**.
- [ ] **100 modèles différents d'arbres et de plantes**, et **100 modèles différents de buissons**.
- [ ] Le buggy laisse des **traces de pneus dans le sable**.
- [ ] **Plage et eau ultra réalistes**.
- [ ] **Poissons et végétation aquatique**.
- [ ] Un **volcan** au milieu de l'île.

## 2. Pilier n°1 : le photoréalisme

Chaque élément est jugé sur une seule question : **« Est-ce que ça pourrait être une photo ou une vidéo filmée en vrai ? »**

### Références visuelles

Des photos réelles d'îles volcaniques tropicales (Polynésie française, Hawaï, La Réunion, Seychelles) pour la couleur de l'eau et du sable, la densité de la jungle et la lumière. On compare les captures du jeu à ces photos.

### Interdits (à vérifier sur chaque capture)

| Interdit | À la place |
|---|---|
| Nuages en image 2D, blancs et plats | Nuages volumétriques 3D éclairés par le soleil, base plus sombre, bords déchiquetés, ombres portées au sol |
| Couleurs saturées, palette simplifiée | Couleurs naturelles, calibrées sur les photos de référence |
| Textures floues ou motif qui se répète | Matériaux PBR scannés (4K au sol), macro-variation pour casser la répétition |
| Lumière plate, ombres absentes ou « flottantes » | Illumination globale dynamique, ombres nettes, ombres de contact |
| Eau bleue opaque et uniforme | Eau transparente, réfraction, dégradé turquoise → bleu profond, écume, caustiques |
| Le même arbre cloné partout | ≥ 100 variantes d'arbres et ≥ 100 de buissons, échelle, rotation et teinte aléatoires |
| Objets qui flottent ou s'enfoncent | Tout est posé au sol : rochers à moitié enterrés, débris au pied des arbres |
| Végétation figée | Vent dynamique sur toutes les plantes, plus fort pendant les orages |

## 3. L'île

- Monde de **4 km × 4 km** (landscape 4033 × 4033, 1 m par point) avec World Partition.
- Île d'environ **3 km de diamètre**, entourée d'une lagune et d'un récif corallien, puis l'océan profond.
- Relief généré par script (Python + numpy, heightmap 16 bits) : cône volcanique central, crêtes, vallées creusées par **érosion hydraulique**, plaines côtières. Le relief doit avoir l'air sculpté par la pluie (ravines, éboulis), pas de bosses de bruit uniformes.
- Si les performances l'exigent, on réduit la taille de l'île avant de réduire la qualité.

| Zone | Où | Contenu |
|---|---|---|
| Plage de départ | Sud | Point d'apparition, buggy garé, lagune turquoise peu profonde, palmiers penchés vers la mer |
| Lagune et récif | Tout autour, plus large au sud et à l'est | Eau de 0,5 à 6 m, coraux, herbiers, bancs de poissons, vagues qui cassent sur le récif |
| Jungle | Entre la côte et les pentes du volcan | Végétation très dense sur 3 étages : canopée, arbustes, sol |
| Rivière et cascade | Flanc nord-ouest | Rivière qui descend du volcan, chute de 40 à 60 m dans un bassin où l'on peut nager |
| Piste d'aviation | Est | Piste en terre et herbe d'environ 800 m, hangar en tôle, avion de brousse |
| Baie de l'hydravion | Ouest | Ponton en bois, hydravion amarré |
| Volcan | Centre | Sommet vers 700 m, cratère fumant, coulées de lave solidifiée, cendres, fumerolles ; végétation de plus en plus rare en montant |
| Pistes | Partout | Chemins de terre et de sable qui relient les zones, praticables en buggy |

## 4. Ciel, soleil et météo

- **Sky Atmosphere** : diffusion physique, ciel bleu profond au zénith, horizon plus clair, couchers de soleil réalistes.
- **Soleil** : Directional Light en unités physiques, trajectoire réaliste (latitude tropicale ~17° S), disque solaire, rayons volumétriques à travers les feuilles et les nuages.
- **Sky Light** en capture temps réel.
- **Nuages : Volumetric Cloud uniquement.** Plusieurs types : cumulus de beau temps, cumulus bourgeonnants, cumulonimbus d'orage, voile d'altitude. Les nuages projettent leur ombre sur l'île et la mer.
- **Brouillard** : Exponential Height Fog avec brouillard volumétrique (brume du matin sur la jungle, rayons de soleil).
- **Cycle jour/nuit** complet, durée réglable (par défaut 1 jour = 48 min). La nuit : lune, étoiles, Voie lactée, lueur du volcan.
- **Météo dynamique** avec transitions douces sur plusieurs minutes : grand beau, nuageux, averse tropicale, orage (pluie dense, éclairs, tonnerre, vent fort, mer agitée), brume.
- **Sous la pluie** : surfaces mouillées (plus sombres, plus brillantes), flaques, gouttes sur l'eau, végétation qui plie. Un paramètre global `Wetness` (Material Parameter Collection) pilote l'aspect mouillé de tous les matériaux.

## 5. Lumière et rendu

- **Lumen** pour l'illumination globale et les réflexions, avec ray tracing matériel sur les cartes qui le supportent. **Lumen Lite** (UE 5.8) pour les machines modestes.
- **Virtual Shadow Maps** et ombres de contact ; ombres de feuillage précises qui bougent avec le vent.
- **MegaLights** pour les lumières de nuit (hangar, phares, lueur du volcan).
- Exposition en unités physiques (pas d'auto-exposition qui « pompe »), tonemapper filmique, bloom léger, pas d'aberration chromatique ni de grain exagérés.
- Étalonnage naturel calibré sur les photos de référence.
- Upscaling : DLSS (NVIDIA), XeSS (Intel, par exemple la MSI Claw), TSR par défaut.
- Sortie jusqu'en **4K (3840 × 2160)** ; la résolution interne est adaptée à la machine.

## 6. Sol et terrain

- Matériau de landscape automatique selon la pente, l'altitude et la distance à l'eau, avec couches peignables : sable sec, sable mouillé (bande près de l'eau), sable de lagune, terre de jungle et feuilles mortes, herbe, boue, roche volcanique, cendres, lave solidifiée.
- Textures PBR scannées, macro-variation, aucune répétition visible.
- Displacement Nanite pour les rides du sable, les cailloux, les racines.
- Falaises et gros rochers : maillages Nanite scannés posés sur le terrain (pas de terrain étiré).
- Débris : coquillages, bois flotté, noix de coco, algues échouées sur la plage ; branches, feuilles et pierres dans la jungle.

### Traces de pneus et de pas

- Le buggy laisse des **traces dans le sable** et la boue : creux, sable plus sombre et tassé, qui suivent exactement les roues, dérapages compris.
- Le joueur laisse des empreintes de pas.
- Technique : render target persistant centré sur le joueur (ou Runtime Virtual Texture), lu par le matériau du sol pour le relief et la couleur. Les traces s'effacent lentement et les vagues les effacent sur le sable mouillé.
- Le buggy projette du sable (Niagara), de la poussière sur les pistes et des gerbes d'eau dans la lagune.

## 7. L'eau (doit être spectaculaire)

- **Plugin Water** : océan, lagune, bassin de la cascade (Lake) et rivière (River).
- **Single Layer Water** : transparence, réfraction, absorption selon la profondeur, du turquoise très clair sur le sable de la lagune au bleu profond derrière le récif.
- **Vagues** : calmes dans la lagune, houle au large, déferlantes sur le récif, plus fortes pendant l'orage.
- **Écume** sur le rivage et le récif, bande de sable mouillé qui suit les vagues.
- **Caustiques** sur le fond de la lagune.
- **Sous l'eau** : post-process dédié (couleur, absorption, brouillard), rayons de lumière, particules en suspension, son étouffé.
- **Interactions** : éclaboussures et sillage du buggy, du joueur et de l'hydravion.

### Vie sous-marine

- **Au moins 8 espèces de poissons tropicaux** en bancs qui évitent le joueur, plus quelques gros animaux (raie, tortue marine).
- Coraux variés (Nanite), anémones, herbiers et algues qui ondulent, rochers, sable ridé.
- Technique : bancs en Niagara (boids) ou instances animées par vertex, pour garder de bonnes performances.

## 8. Végétation : dense, variée, partout sauf sur la plage

### Bibliothèque de modèles

- **≥ 100 modèles différents d'arbres et de grandes plantes**, dont **au moins 30 palmiers et cocotiers** (droits, penchés vers la mer, jeunes, vieux, cassés, avec ou sans noix de coco). Le reste : bananiers, banians, fougères arborescentes, pandanus, arbres à fleurs, arbres morts, souches…
- **≥ 100 modèles différents de buissons et de plantes basses** : fougères, monstera, héliconias, gingembres sauvages, hibiscus, herbes hautes, lianes, plantes grimpantes, jeunes pousses, plantes de bord de mer, mousses, champignons…
- **Méthode** : on part d'espèces **scannées réelles** (qualité photo). Les variantes sont générées avec le **Procedural Vegetation Editor** d'UE 5.8 (forme, taille, densité du feuillage, âge). Tous les modèles sont en Nanite et animés par le vent.
- Aucun modèle fait de formes géométriques simples : un modèle qui ne passe pas le test photo est rejeté.
- Une **planche de présentation** (niveau de test avec les 200 modèles alignés) sert à les valider.

### Placement (PCG)

- Graphes PCG par zone et par étage : canopée, étage intermédiaire, sous-bois, couvre-sol, débris.
- Jungle **très dense** ; transition naturelle vers la plage, où il ne reste que quelques palmiers et plantes de plage, le sable restant dégagé.
- Exclusions : sable de plage, eau, pistes, piste d'aviation, bâtiments, pentes trop raides, cratère.
- Variation par instance : échelle, rotation, inclinaison, teinte, quelques feuilles jaunies.
- Regroupements naturels (bosquets, clairières), jamais de répartition uniforme.
- Les retouches manuelles doivent survivre à une régénération (édition manuelle du PCG en 5.8).

## 9. La cascade

- Chute de 40 à 60 m depuis une falaise de basalte couverte de mousse et de fougères, dans un bassin profond où l'on peut nager et plonger.
- Eau qui coule (maillage + matériau d'écoulement avec flow map), rideau plus fin sur les bords.
- **Particules Niagara** : embruns, brume qui monte du bassin, gouttelettes, écume au pied, éclaboussures sur les rochers.
- Rochers mouillés et brillants ; arc-en-ciel dans la brume quand le soleil est dans le bon angle (bonus).
- Son puissant qui s'entend de loin.

## 10. Le volcan

- Visible de partout : c'est le repère principal de l'île.
- Panache de fumée et de vapeur **volumétrique** (pas de sprites plats), fumerolles sur les flancs.
- Roche volcanique, scories, cendres, coulées de lave solidifiée.
- La nuit : lueur orange du cratère qui éclaire le panache par en dessous.

## 11. Le joueur

- Vue à la troisième personne, vue à la première personne en option.
- Marcher, courir, sauter, nager, plonger.
- Monter dans les véhicules et en descendre (touche E ou bouton de manette).
- Manette et clavier/souris (la MSI Claw a une manette intégrée).
- Mannequin par défaut au début ; humain réaliste (MetaHuman) plus tard.

## 12. Le buggy (au point d'apparition)

- Buggy tubulaire tout-terrain de design original (aucune marque réelle).
- Physique **Chaos Vehicles** : suspensions à grand débattement visibles, poids réaliste, transfert de masse, dérapages dans le sable.
- Adhérence selon la surface (Physical Materials) : sable sec, sable mouillé, terre, herbe, boue, roche, eau peu profonde.
- Caméra de poursuite et caméra embarquée, phares pour la nuit.
- Son du moteur selon le régime, bruits de roulement selon la surface.
- Traces de pneus et projections (voir §6).

## 13. Les avions (à trouver sur l'île)

1. **Avion de brousse** monomoteur à aile haute, sur la piste est.
2. **Hydravion** à flotteurs, dans la baie ouest : décolle de l'eau et amerrit.

Pour chaque avion :

- Modèle très détaillé : cockpit avec instruments, rivets, usure, salissures. Design original, aucune marque réelle.
- Modèle de vol **réaliste mais accessible** : portance, traînée, poussée, décrochage, volets.
- Gouvernes animées (ailerons, profondeur, direction), hélice avec flou de mouvement à haut régime.
- Vue extérieure et vue cockpit, son du moteur et du vent.
- Effets : poussière au décollage, gerbes d'eau pour l'hydravion.

## 14. Son

- Ambiances par zone et par heure : vagues, ressac sur le récif, vent dans les palmiers, oiseaux tropicaux le jour, insectes et grenouilles la nuit, pluie, tonnerre, cascade, grondement sourd du volcan.
- Son 3D avec atténuation et occlusion, son étouffé sous l'eau.

## 15. Interface et réglages graphiques

- HUD minimal : vitesse du buggy ; vitesse, altitude et cap de l'avion. Rien d'autre à l'écran.
- Menu Options : résolution jusqu'en **4K**, plein écran ou fenêtré, préréglages **Bas / Moyen / Élevé / Épique / Cinéma**, upscaler (DLSS / XeSS / TSR), Lumen / Lumen Lite / ray tracing matériel, distance de vue, densité de végétation, limite et compteur de FPS.
- Mode photo (bonus) : caméra libre, choix de l'heure et de la météo.

## 16. Objectifs de performance

| Machine | Réglages | Sortie | Objectif |
|---|---|---|---|
| MSI Claw A1M (Intel Arc intégré, 16 Go) | Bas + Lumen Lite + XeSS | 1080p (interne ~720p) | 30 fps |
| PC vers 800 € (RTX 5060, 16 à 32 Go) | Élevé + DLSS | 1440p | 60 fps |
| PC haut de gamme (RTX 4080/5080 ou mieux) | Épique/Cinéma + DLSS + ray tracing matériel | 4K | 60 fps |

- Mesure avec `stat unit`, `stat gpu` et Unreal Insights à chaque jalon, sur les points de vue de référence (§18).
- Mémoire vidéo : rester sous 6 Go sur une carte de 8 Go.

## 17. Technologies (Unreal Engine 5.8)

| Besoin | Outil |
|---|---|
| Terrain | Landscape + World Partition (Mesh Terrain, expérimental, seulement si on a besoin de surplombs ou de grottes) |
| Géométrie détaillée | Nanite (rochers, falaises, végétation) |
| Lumière | Lumen / Lumen Lite, Virtual Shadow Maps, MegaLights |
| Ciel | Sky Atmosphere, Volumetric Cloud, Exponential Height Fog, Sky Light |
| Eau | Plugin Water, Single Layer Water |
| Végétation | Procedural Vegetation Editor (expérimental), Nanite Foliage, PCG |
| Effets | Niagara (cascade, embruns, pluie, fumée, sable, poissons) |
| Buggy | Chaos Vehicles |
| Avions | Modèle de vol en C++ sur Chaos Physics |
| Traces | Render targets ou Runtime Virtual Textures |
| Automatisation | Python de l'éditeur + serveur MCP intégré à Unreal (pilotage par Claude) |

## 18. Plan de construction (jalons)

**Règle :** un jalon à la fois. Un jalon n'est terminé que lorsque ses critères sont validés **avec des captures d'écran** et approuvés par le joueur.

### Points de vue de référence

Huit caméras fixes posées au jalon 1 et réutilisées à chaque jalon. Captures haute résolution à quatre heures (8 h, 13 h, 18 h 30, 23 h) :

1. Plage de départ, au ras du sable, vers la lagune.
2. Plage de départ, vers la jungle et le volcan.
3. Sous l'eau, dans la lagune.
4. Au cœur de la jungle.
5. Au pied de la cascade.
6. Vue aérienne de toute l'île à 1 500 m.
7. Au bord du cratère.
8. Sur la piste d'aviation, avec l'avion.

| # | Jalon | Terminé quand… |
|---|---|---|
| 0 | Projet, plugins, dossiers, Git, MCP | Le projet s'ouvre, Claude pilote l'éditeur via MCP, premier commit |
| 1 | Relief de l'île | Vue aérienne crédible (érosion, ravines), échelle juste, caméras de référence posées |
| 2 | Ciel, soleil, nuages, jour/nuit, météo | Les 4 heures et l'orage sont crédibles sur les 8 vues |
| 3 | Matériaux du sol, rochers, débris | Plus aucune répétition visible, sable et roche crédibles en gros plan |
| 4 | Océan, lagune, récif, rivière, bassin, vue sous l'eau | Dégradé de couleur, écume, caustiques et vue sous-marine crédibles |
| 5 | Bibliothèque de végétation (100 + 100) | Planche des 200 modèles, tous validés au test photo |
| 6 | Placement de la végétation (PCG) | Jungle dense, plage dégagée, objectif de fps tenu sur la machine du joueur |
| 7 | Cascade et volcan | Vues 5 et 7 validées, de jour comme de nuit |
| 8 | Joueur, buggy, traces de pneus | On apparaît, on conduit partout, les traces dans le sable sont visibles |
| 9 | Vie sous-marine | Bancs de poissons, coraux et herbiers sur la vue 3 |
| 10 | Avions (brousse + hydravion) | Décollage, vol, atterrissage et amerrissage complets |
| 11 | Sons, HUD, menu des options (4K, préréglages) | Tous les réglages fonctionnent, 4K sélectionnable |
| 12 | Optimisation et version jouable Windows | Objectifs du §16 tenus, jeu packagé (.exe) qui se lance |

## 19. Assets et licences

- Sources autorisées : **Fab** (la boutique d'Epic, avec Quixel Megascans), **Poly Haven** (CC0), contenus d'exemple d'Epic, et ce que Claude génère lui-même (relief, matériaux procéduraux, variantes de végétation).
- Chaque asset ajouté est listé dans `docs/ASSETS.md` avec sa source, sa licence et son prix.
- Aucun asset copié d'un autre jeu, aucun logo ni modèle de marque réelle.
- **Aucun achat sans l'accord du joueur.**

## 20. Plus tard (pas maintenant)

Éruption du volcan, bateau et jet-ski, faune terrestre (oiseaux, crabes), missions, humains réalistes (MetaHuman), multijoueur.
