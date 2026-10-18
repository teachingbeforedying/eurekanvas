# eurekanvas : notes de travail pour Claude

## Le projet

Un moteur de canevas infini (pas de limite en largeur, hauteur ni profondeur, on peut zoomer pendant qu'on dessine), et les applis construites dessus :

- `packages/engine/` : le moteur.
- `apps/mathgame/` : des activités maths par manipulation d'objets, comme des niveaux d'un jeu de logique (façon sokoban). L'élève se trompe beaucoup, puis comprend, et progresse en s'amusant. En ligne sur https://mathgame.fr.
- `apps/zpixeleditor/` : un éditeur pixel (un bon vieux paint) avec des pixels parfaits à n'importe quel niveau de zoom. Pour https://zpixeleditor.com.
- `apps/zveceditor/` : un éditeur vectoriel « 2,5D » : on peut changer le niveau de zoom pendant le tracé d'une courbe à main levée.
- `docs/ideas/` : les idées du projet, classées.

## Décisions (2026-10-18)

- **Approche** : noyau neuf + portage par morceaux. On ne refactore pas l'ancien monolithe : on réécrit le noyau (caméra à zoom infini, coordonnées, zones de rendu, dessin) avec des tests, puis on porte le contenu maths au besoin. Voir `docs/audit-ancien-moteur.md`.
- **Langage et outillage** : TypeScript, Vite, Vitest, workspaces npm (`packages/*`, `apps/*`).
- **Premier tronçon** : le zoom pendant le tracé (cœur de zveceditor). Conception et questions ouvertes dans `docs/noyau.md` : ne pas coder le noyau avant que Sébastien ait tranché ces questions.

## Commandes

Depuis la racine : `npm install`, `npm test` (Vitest, tous les workspaces), `npm run build`.

## Workflow git

- **Ne jamais commit ni pousser sans demande explicite** (« commit », « pousse », « commit et pousse »). Avant un commit, montrer les fichiers concernés et le message.
- Messages de commit en français, courts, à l'impératif (« Ajoute le zoom molette »).
- Code et identifiants en anglais.
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
