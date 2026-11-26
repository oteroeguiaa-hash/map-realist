# Installer le PC et relier Claude à Unreal Engine

Ce guide marche pour la **MSI Claw A1M** comme pour un futur PC Windows. Compte quelques heures, surtout pour les téléchargements.

> Les noms exacts des menus peuvent changer d'une version d'Unreal à l'autre. En cas de doute, la documentation officielle d'Epic fait foi, et une fois l'étape 3 faite, Claude pourra t'aider directement sur ta machine.

## Avant de commencer

- Branche la machine sur secteur et mets le **mode performance** (MSI Center M sur la Claw).
- Un **clavier et une souris** sont fortement conseillés.
- Libère **au moins 200 Go** sur le disque (Unreal, Visual Studio, projet, assets).
- Mets à jour Windows et le **pilote graphique** (Intel Arc pour la Claw, NVIDIA pour un PC RTX).
- Empêche la mise en veille pendant que tu travailles (Paramètres Windows → Système → Alimentation).

## Étape 1 — Unreal Engine 5.8

1. Télécharge l'**Epic Games Launcher** sur le site d'Epic Games, installe-le et connecte-toi avec un compte Epic.
2. Onglet **Unreal Engine** → **Bibliothèque** → bouton **+** → choisis la version **5.8** (ou plus récente) → **Installer**.
3. Lance Unreal une fois pour vérifier qu'il démarre.

## Étape 2 — Visual Studio et Git

1. Installe **Visual Studio Community** (gratuit) avec la charge de travail **« Développement de jeux en C++ »** et le composant **Unreal Engine** proposé dans cette charge. Prends la version recommandée par Epic pour UE 5.8. C'est nécessaire pour le code du buggy et des avions.
2. Installe **Git for Windows** (Git LFS est inclus) en laissant les options par défaut.
3. Ouvre **PowerShell** et tape :

   ```powershell
   cd $HOME\Documents
   git lfs install
   git clone https://github.com/oteroeguiaa-hash/map-realist.git
   ```

   GitHub te demandera de te connecter : suis les instructions à l'écran.

## Étape 3 — Claude Code

Dans PowerShell :

```powershell
irm https://claude.ai/install.ps1 | iex
```

Ferme PowerShell, rouvre-le, puis :

```powershell
cd $HOME\Documents\map-realist
claude
```

Connecte-toi avec ton compte Claude. À partir de là, tu peux demander de l'aide à Claude directement sur ta machine pour les étapes suivantes.

## Étape 4 — Créer le projet Unreal

1. Dans le launcher, lance Unreal Engine 5.8.
2. **Jeux** → **Vide** (Blank).
3. Type de projet : **C++**. Qualité : **Maximum**. Contenu de démarrage : **non**. Ray tracing : **oui** si tu as une carte NVIDIA RTX, sinon non.
4. Emplacement : `Documents\map-realist`. Nom : **`MapRealist`**.
5. Clique sur **Créer**. Le projet sera dans `Documents\map-realist\MapRealist\`.

La première ouverture peut être très longue (compilation des shaders), surtout sur la Claw. C'est normal.

## Étape 5 — Le pont MCP entre Claude et Unreal

Unreal Engine 5.8 contient son propre serveur MCP.

1. Dans l'éditeur : **Edit → Plugins**, cherche **MCP**, active **Unreal MCP** et **All Toolsets**, puis redémarre l'éditeur. *All Toolsets* fournit les outils : sans lui, Claude ne peut rien faire.
2. Ouvre la console d'Unreal avec la touche **²** (en haut à gauche du clavier AZERTY) et tape :

   ```
   ModelContextProtocol.StartServer
   ```

   Pour qu'il démarre tout seul à chaque fois : **Edit → Editor Preferences**, cherche **Auto Start Server** et coche-le.
3. Toujours dans la console :

   ```
   ModelContextProtocol.GenerateClientConfig ClaudeCode
   ```

   Ça crée un fichier `.mcp.json` dans `MapRealist\`. **Copie-le à la racine** `map-realist\`, là où tu lances Claude (ou demande à Claude de le faire).
4. Dans PowerShell, relance `claude` depuis `Documents\map-realist`, accepte le serveur MCP quand on te le demande, puis tape `/mcp` : le serveur Unreal doit apparaître comme **connecté**.
5. Optionnel : Epic publie des instructions pour Claude Code, à installer avec :

   ```
   /plugin install unreal-engine-skills-for-claude-code@claude-plugins-official
   ```

**Si la liste d'outils est vide :** vérifie que *All Toolsets* est bien activé, que l'éditeur a été redémarré et que le serveur tourne (message dans l'Output Log).

## Étape 6 — Piloter depuis ton iPhone (Remote Control)

1. Laisse la machine allumée, branchée, avec Unreal ouvert.
2. Dans PowerShell, depuis `Documents\map-realist`, lance :

   ```powershell
   claude remote-control
   ```

   ou, dans une session Claude déjà ouverte, tape `/remote-control`.
3. Sur ton iPhone, ouvre l'app **Claude**, partie **Code** : la session de ta machine apparaît, et tu peux me parler depuis le téléphone pendant que je travaille dans Unreal.

## Étape 7 — Lancer la construction

Envoie ce premier message à Claude :

> Lis `CLAUDE.md` et `docs/GAME_DESIGN.md`, vérifie que le MCP d'Unreal est connecté, puis commence le jalon 0.

Ensuite, on avance **un jalon à la fois**, avec des captures d'écran à valider à chaque étape.

**À savoir :** construire un jeu comme celui-ci consomme beaucoup d'utilisation Claude. Selon ton abonnement, tu atteindras les limites d'utilisation et il faudra avancer sur plusieurs jours ou plusieurs semaines. C'est normal : le projet est découpé en jalons pour ça.
