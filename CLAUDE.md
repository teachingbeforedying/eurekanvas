# eurekanvas : notes de travail pour Claude

## Le projet

Un moteur de canevas infini (pas de limite en largeur, hauteur ni profondeur, on peut zoomer pendant qu'on dessine), et les applis construites dessus :

- `packages/engine/` : le moteur (nombres exacts, caméra, traits en sections, choix de ce qu'on dessine, format JSON). Pur : testable sous Node, ne connaît aucune bibliothèque de dessin.
- `packages/renderer-fabric/` : le rendu avec fabric.js 7 (implémente l'interface `Renderer` du moteur).
- `apps/mathgame/` : des activités maths par manipulation d'objets, comme des niveaux d'un jeu de logique (façon sokoban). L'élève se trompe beaucoup, puis comprend, et progresse en s'amusant. En ligne sur https://mathgame.fr.
- `apps/zpixeleditor/` : un éditeur pixel (un bon vieux paint) avec des pixels parfaits à n'importe quel niveau de zoom. Pour https://zpixeleditor.com.
- `apps/zveceditor/` : un éditeur vectoriel « 2,5D » : on peut changer le niveau de zoom pendant le tracé d'une courbe à main levée.
- `docs/ideas/` : les idées du projet, classées.

## Décisions (2026-10-18)

- **Approche** : noyau neuf + portage par morceaux. On ne refactore pas l'ancien monolithe : on réécrit le noyau (caméra à zoom infini, coordonnées, zones de rendu, dessin) avec des tests, puis on porte le contenu maths au besoin. Voir `docs/audit-ancien-moteur.md`.
- **Langage et outillage** : TypeScript, Vite, Vitest, workspaces npm (`packages/*`, `apps/*`).
- **Premier tronçon** : le zoom pendant le tracé (cœur de zveceditor). Conception et décisions dans `docs/noyau.md` :
  - rendu avec **fabric.js 7.4.0**, derrière une petite interface de rendu (un Canvas 2D direct reste possible plus tard) ;
  - positions et zoom en **rationnels dyadiques `BigInt`** (`n / 2^e`), repli sur decimal.js si le prototype échoue ;
  - un trait qui traverse plusieurs niveaux de zoom est **découpé en sections**, une par niveau entier (ancrage exact + points en flottants locaux) ;
  - chaque point porte son **épaisseur**, choisie pour être constante à l'écran au moment du tracé, et le trait est dessiné en capsules effilées : dégradé continu, pas de coupure par cran de molette (contrairement à l'ancien code).
- **Stylo de zveceditor** : lisse par défaut, avec une « corde » (`apps/zveceditor/src/rope.ts`) dont la longueur suit la vitesse de la main (la distance parcourue en 50 ms, entre 4 et 128 px d'écran). `S` passe du stylo brut à la corde fixe (16 px), puis à la corde-vitesse ; `[` et `]` règlent la longueur ou le retard. Au relâchement, rien n'est ajouté : le trait s'arrête au pinceau (ce qu'on voit pendant le tracé est ce qu'on obtient). Le bouton droit ou du milieu déplace la vue même pendant un tracé, bouton gauche enfoncé. Les boutons se lisent dans le masque `event.buttons` (un second bouton ne produit pas de `pointerdown`).
- **Dessins de zveceditor** : enregistrés automatiquement dans le navigateur (IndexedDB, avec la vue). `Ctrl+S` télécharge un fichier `.zvec.json` (format `eurekanvas/drawing` version 2, `docs/drawing-format.md`), `Ctrl+O` ajoute les objets d'un fichier, `K` efface tout, et `Ctrl+Z` annule la dernière action (un trait, un ajout ou un effacement).
- **Dessiner et sélectionner, comme l'ancienne version** : on dessine en tenant `²` (touche `Backquote`) puis le bouton gauche ; tous les traits d'un même appui sur `²` forment un objet (un groupe). Sans `²`, le bouton gauche sélectionne : chantier en cours, en quatre étapes ; les décisions sont dans `docs/noyau.md`, « La sélection : décisions ». L'interface n'affiche que le dessin : `H` montre le panneau, et les messages passent en bas de l'écran.
- **Limite connue** : le canvas d'un navigateur calcule en simple précision, donc une section qui s'étend à plus de ~4 millions de pixels de son point de pose n'est pas dessinée. Les traits lointains en niveaux disparaissent plus tôt que dans l'ancienne version (14 niveaux au lieu de 24 pour une section de 100 unités locales). Voir `docs/noyau.md` pour la mesure et la suite possible.

## Commandes

Depuis la racine : `npm install`, `npm test` (Vitest, tous les workspaces), `npm run build`, et `npm run dev --workspace @eurekanvas/zveceditor` pour lancer la page jouable (http://localhost:5173).

## Workflow git

- **Ne jamais commit ni pousser sans demande explicite** (« commit », « pousse », « commit et pousse »). Avant un commit, montrer les fichiers concernés et le message.
- Messages de commit en français, courts, à l'impératif (« Ajoute le zoom molette »).
- **Code en anglais pur** : identifiants, commentaires, noms de tests, clés JSON et noms de fichiers de code, sans mots français ni franglais, pour que des gens qui récupèrent le code ne soient pas surpris. Les notes de travail dans `docs/` restent en français, sauf les spécifications destinées à des lecteurs tiers (`docs/stroke-format.md`, en anglais). Une partie d'un trait dessinée à un niveau de zoom s'appelle `Section` (pas « bout » : Sébastien employait ce mot au sens anglais de *round*, comme dans `DrawingBout` de l'ancien code).
- On travaille sur `main`. Pour un gros chantier : une branche et une PR, si Sébastien veut relire avant de fusionner.
- L'email de commit est réglé localement dans ce repo (`sebastien_hugot@protonmail.com`). Ne pas modifier la config git globale.

## Références (lecture seule, ne jamais y écrire)

- `C:\DEV\infiniteCanvas-main\3DRoom+ic.html` : **version la plus récente** de l'ancien moteur (mai 2025, en avance sur GitHub, pas sous git).
- `C:\DEV\__SHUCLAUDE\a-user-interface` : ancien moteur + mathgame (fabric.js, `3DRoom+ic.html` ~127 000 lignes, `lib/`). Les défis maths se lancent avec `3DRoom+ic.html?challenge=...`, depuis `index.html`.
- `C:\DEV\__SHUCLAUDE\zpsite` : ancien serveur express de zpixeleditor.com (sert `3DRoom+ic.html` en injectant une sauvegarde `.shu`).
- `C:\DEV\__SHUCLAUDE\iC__recherche` : recherches autour du canevas infini.
- Les idées : `still_shute.txt`, `programmashute.txt`, `_book/still_book.md` dans `a-user-interface`.
- Repères de lignes (zoom, dessin, maths, défis, slots) dans `3DRoom+ic.html` : tableau « Repères pour le portage » de `docs/audit-ancien-moteur.md`.

## Hébergement

- mathgame.fr : hébergement Apache (fichiers statiques), sert une ancienne version du moteur.
- zpixeleditor.com : VPS OVH (`51.91.255.236`), node/express derrière nginx et pm2. Hors ligne depuis 2025.
