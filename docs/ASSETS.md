# Assets utilisés

Chaque asset qui n'a pas été créé dans le projet est listé ici, pour respecter les licences et pouvoir tout retélécharger sur une autre machine. Les packs téléchargés ne sont pas versionnés dans Git.

| Nom | Source | Licence | Prix | Dossier dans le projet | Utilisé pour |
|---|---|---|---|---|---|
| Textures sand_01, forest_leaves_02, leafy_grass, dark_rock_02, burned_ground_01, brown_mud_leaves_01, palm_tree_bark, bark_brown_02 | Poly Haven | CC0 | gratuit | `web/assets/tex` (démo web) | Sol de l'île, écorces |
| Textures farm_soil, dry_river_pebbles et photo HDR rainforest_trail (1k) | Poly Haven | CC0 | gratuit | `web/assets/tex`, `web/assets/hdri` | Pistes, galets des rives, éclairage d'ambiance |
| Modèles fern_02, anthurium_botany_01, calathea_orbifolia_01, shrub_sorrel_01 (feuilles) | Poly Haven | CC0 | gratuit | `web/assets/tex/veg_*` | Feuilles des buissons et des arbres |
| Modèles rock_07, rock_09, moon_rock_02, rock_face_01, lambis_shell, dead_tree_trunk | Poly Haven | CC0 | gratuit | `web/assets/mdl` | Rochers, falaise de la cascade, coquillages, bois flotté |


## Modèles 3D du joueur (démo web)

Les fichiers d'origine sont dans le dépôt GitHub du joueur `ile-3d`. La démo en utilise des copies allégées (WebP, maillages simplifiés, compression meshopt) produites par `node web/tools/prep_glb.mjs <dossier ile-3d>`. Ces copies ne sont pas versionnées ici.

Attention aux licences : **CC-BY** demande de citer l'auteur (fait dans le menu « Crédits » de la démo) ; **NC** interdit tout usage commercial ; **ND** interdit de modifier le modèle (le crocodile est donc utilisé tel quel, sans simplification) ; **SA** impose la même licence aux dérivés.

| Fichier | Auteur | Licence | Prix | Dossier | Utilisé pour |
|---|---|---|---|---|---|
| `tropical_palm_tree.glb` — Tropical Palm Tree | assetfactory (https://sketchfab.com/assetfactory) (Sketchfab) | SKETCHFAB Standard | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/palm.data.json` (généré, non versionné) | veg |
| `jungle_tree.glb` — Jungle tree | stuff scanner (https://sketchfab.com/boypuff) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/jungle.data.json` (généré, non versionné) | veg |
| `monstera_plants.glb` — Monstera Plants | eb78 (https://sketchfab.com/E.A.Cornell) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/monstera.data.json` (généré, non versionné) | veg |
| `tropical_plants_pack_m02p.glb` — Tropical Plants Pack M02P | MozzarellaARC (https://sketchfab.com/mozzarellaARC) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/plants.data.json` (généré, non versionné) | veg |
| `rochers_calcaires.glb` — Rochers calcaires | ab-studio (https://sketchfab.com/ab-studio) (Sketchfab) | CC-BY-NC-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/rocks.data.json` (généré, non versionné) | rock |
| `apocalyptic_off_road_buggy.glb` — Apocalyptic Off Road Buggy | geevisual55 (https://sketchfab.com/geevisual55) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/buggy.data.json` (généré, non versionné) | vehicle |
| `avion_jgp.glb` — Avion JGP | omegaodin34 (https://sketchfab.com/omegaodin34) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/plane.data.json` (généré, non versionné) | vehicle |
| `viking_axe__hache_vinking.glb` — Viking Axe | Hache Vinking | SniperKing (https://sketchfab.com/sniperking) (Sketchfab) | CC-BY-NC-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/axe.data.json` (généré, non versionné) | tool |
| `rivelaine.glb` — rivelaine | Alexandre (https://sketchfab.com/Nephiriane) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/rivelaine.data.json` (généré, non versionné) | tool |
| `tiger.glb` — Tiger | Blender Guru (https://sketchfab.com/psk98077) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/tiger.data.json` (généré, non versionné) | animal |
| `jaguar.glb` — jaguar | Ear.Rodriguez (https://sketchfab.com/Ear.Rodriguez) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/jaguar.data.json` (généré, non versionné) | animal |
| `komodo.glb` — Komodo | denys4624 (https://sketchfab.com/denys4624) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/komodo.data.json` (généré, non versionné) | animal |
| `boar_-_realistic_3d_model_demo_free.glb` — BOAR - Realistic 3D Model (DEMO FREE) | WildMesh 3D (https://sketchfab.com/WildMesh_3D) (Sketchfab) | CC-BY-NC-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/boar.data.json` (généré, non versionné) | animal |
| `ball_python__piton_bola.glb` — Ball python / Piton bola | Franco.S.Alejandre (https://sketchfab.com/Franco.S.Alejandre) (Sketchfab) | CC-BY-NC-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/python.data.json` (généré, non versionné) | animal |
| `nile_crocodile_swimming.glb` — Nile Crocodile Swimming | Monster (https://sketchfab.com/monster) (Sketchfab) | CC-BY-NC-ND-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/croc.data.json` (généré, non versionné) | animal |
| `low_poly_monkey_animal_3d_model_free.glb` — Low poly monkey animal 3d model free | iRahulRajput (https://sketchfab.com/rt699448) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/monkey.data.json` (généré, non versionné) | animal |
| `crab_7-_eleven.glb` — Crab 7- Eleven | aaadragon (https://sketchfab.com/aaadragon) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/crab.data.json` (généré, non versionné) | animal |
| `model_50a_-_hawksbill_sea_turtle.glb` — Model 50A - Hawksbill Sea Turtle | DigitalLife3D (https://sketchfab.com/DigitalLife3D) (Sketchfab) | CC-BY-NC-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/turtle.data.json` (généré, non versionné) | animal |
| `the_fish_particle.glb` — The Fish Particle | Loïc Norgeot (https://sketchfab.com/norgeotloic) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/fishschool.data.json` (généré, non versionné) | animal |
| `great_white_shark.glb` — Great White Shark | charliegodofsharks (https://sketchfab.com/charliegodofsharks) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/shark.data.json` (généré, non versionné) | animal |
| `parrot.glb` — Parrot | SDPM Esare (https://sketchfab.com/sdpm) (Sketchfab) | CC-BY-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/parrot.data.json` (généré, non versionné) | animal |
| `aracari_a_collier.glb` — Araçari à collier | Tavernier Amaury (https://sketchfab.com/svtavernier) (Sketchfab) | CC-BY-NC-SA-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/aracari.data.json` (généré, non versionné) | animal |
| `parrots_of_the_caribbean.glb` — Parrots of the Caribbean | Eleni Kofekidou (https://sketchfab.com/EleniKofekidou) (Sketchfab) | CC-BY-NC-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/parrots.data.json` (généré, non versionné) | animal |
| `seagull.glb` — Seagull | kenchoo (https://sketchfab.com/kenchoo) (Sketchfab) | CC-BY-NC-SA-4.0 | gratuit | dépôt `ile-3d` du joueur → `web/assets/glb/seagull.data.json` (généré, non versionné) | animal |

## Nouveau décor Poly Haven (fourni par le joueur dans `ile-3d`, CC0)

Fichiers `.gltf.zip` convertis par `node web/tools/prep_glb.mjs <dossier ile-3d>` (non versionnés) : boulder_01, dead_tree_trunk_02, fern_02, grass_medium_01, mountainside, namaqualand_boulder_02, namaqualand_boulder_05, namaqualand_cliff_01, othonna_cerarioides, rock_face_02, rock_moss_set_02, root_cluster_01, sand_rocks_small_01. Les .jpg fournis n'ont pas de canal alpha : le script récupère le masque alpha d'origine sur Poly Haven (même asset) pour fern_02, grass_medium_01 et othonna_cerarioides.

Éclairage : `stream_2k.exr` réduit en 1k par `node web/tools/prep_hdri.mjs` → `web/assets/hdri/stream_1k.exr`. Textures du sol : falaises = rock_face_02, haut du volcan = mountainside.

Retirés : anciens rochers, falaise, coquillages, bois flotté Poly Haven (`web/assets/mdl`), rochers calcaires, monstera, bananiers et fougères du pack de plantes, photo HDR rainforest_trail.
