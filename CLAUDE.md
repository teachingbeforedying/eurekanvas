# eurekanvas : notes de travail pour Claude

## Le projet

Un moteur de canevas infini (pas de limite en largeur, hauteur ni profondeur, on peut zoomer pendant qu'on dessine), et les applis construites dessus :

- `packages/engine/` : le moteur.
- `apps/mathgame/` : des activités maths par manipulation d'objets, comme des niveaux d'un jeu de logique (façon sokoban). L'élève se trompe beaucoup, puis comprend, et progresse en s'amusant. En ligne sur https://mathgame.fr.
- `apps/zpixeleditor/` : un éditeur pixel (un bon vieux paint) avec des pixels parfaits à n'importe quel niveau de zoom. Pour https://zpixeleditor.com.
- `apps/zveceditor/` : un éditeur vectoriel « 2,5D » : on peut changer le niveau de zoom pendant le tracé d'une courbe à main levée.
- `docs/ideas/` : les idées du projet, classées.

L'outillage (langage, bundler, workspaces) n'est pas encore choisi.

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

## Hébergement

- mathgame.fr : hébergement Apache (fichiers statiques), sert une ancienne version du moteur.
- zpixeleditor.com : VPS OVH (`51.91.255.236`), node/express derrière nginx et pm2. Hors ligne depuis 2025.
