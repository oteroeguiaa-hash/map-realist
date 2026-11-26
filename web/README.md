# Démo web — Map Realist

Version jouable dans le navigateur (iPhone compris) de l'île du cahier des charges, en attendant la version Unreal Engine.
Rendu en temps réel avec three.js (WebGL 2).

## Contenu

- Île de 2 km générée par script : volcan avec cratère et ravines, érosion hydraulique, lagon, récif, cascade de 30 m, rivière, piste d'aviation, route côtière.
- Ciel physique (diffusion Rayleigh et Mie), nuages volumétriques calculés en temps réel, heure et météo réglables.
- Eau : vagues de Gerstner, transparence selon la profondeur, caustiques, écume, vue sous l'eau.
- Végétation : 100 types d'arbres et de palmiers, 100 types de buissons, générés de façon procédurale et placés en dizaines de milliers d'exemplaires, avec imposteurs au loin.
- Buggy avec suspensions, adhérence selon le sol, traces de pneus dans le sable, projections de sable.
- Avion de brousse, hydravion, ponton, abri, poissons, coraux, herbiers, fumée du volcan, brume de la cascade, ambiance sonore synthétisée.

## Construire et tester

```bash
cd web
npm install
node tools/build.mjs          # assemble dist/index.html + dist/assets
node tools/test.mjs views     # rendu dans Chromium, captures dans /tmp/shots
```

Pour régénérer les données (les fichiers de `assets/` sont déjà fournis) :

```bash
node tools/gen_terrain.mjs                    # relief, masques, points clés
node tools/gen_clouds.mjs                     # bruits 3D des nuages
python3 tools/prep_textures.py <dossier_ph>   # textures et atlas de végétation
node tools/prep_models.mjs <dossier_ph>       # rochers et objets scannés simplifiés
```

`<dossier_ph>` contient les fichiers téléchargés depuis Poly Haven (voir `docs/ASSETS.md`).
