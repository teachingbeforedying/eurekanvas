# Noyau : note de conception du premier tronçon

Premier tronçon : **le zoom pendant le tracé**. On trace un trait à main levée avec la souris, et on peut changer le niveau de zoom (molette) alors que le trait est en cours. Le trait doit rester exact, même après plusieurs centaines de niveaux de zoom.

C'est le cœur de zveceditor et la base de zpixeleditor. Il est choisi parce qu'il valide le noyau : si la caméra et la précision tiennent ici, le reste (objets, slots, maths) se construit dessus.

Contexte : voir [audit-ancien-moteur.md](./audit-ancien-moteur.md).

## Le problème de fond

Un `number` JavaScript est un flottant 64 bits : 53 bits de précision, et un exposant limité (un facteur de zoom de 2^1024 déborde en `Infinity`). Un zoom « infini » ne peut donc pas être un simple facteur multiplicatif sur des coordonnées flottantes.

L'ancien moteur le résout ainsi (à garder comme principe) :

- le **niveau de zoom est un entier** (`zLevel`, en puissances de 2) auquel s'ajoute un facteur continu de faible amplitude ;
- les positions précises sont exprimées dans une représentation à précision arbitraire, et le rendu ne manipule que des flottants **relatifs à la caméra** (petits, donc exacts) ;
- les objets sont rangés en **zones de rendu** par niveau de zoom, et seuls ceux du niveau courant et de ses voisins sont dessinés ;
- un trait tracé pendant un changement d'échelle est **découpé en bouts**, un par échelle (`DrawingSession` → `DrawingBout`).

## Questions ouvertes (à trancher avant de coder)

Pour chacune : ma recommandation de départ, et pourquoi. Rien n'est figé : un prototype et des tests la confirmeront ou l'invalideront.

### 1. Rendu : Canvas 2D direct ou fabric ?

**Recommandation : Canvas 2D direct, sans fabric.** Dans l'ancien code, fabric ne sert que de rasterisseur, d'outil de sélection et de détection de clic, et il a fallu l'étendre ou le patcher dans 20 fichiers pour le plier au zoom infini. Pour des traits, un rendu direct est simple. La sélection et la détection de clic viendront plus tard, avec notre propre index spatial (les zones de rendu).

### 2. Quel type de grand nombre ?

Trois pistes :

- **A. Rationnels dyadiques (mantisse `BigInt`, exposant entier)** : une valeur vaut `n / 2^e`. Zoomer d'un facteur 2, c'est changer l'exposant : exact et sans coût. Pas de dépendance. Les flottants du rendu sont obtenus en soustrayant le centre de la caméra puis en convertissant la différence.
- **B. `decimal.js`** (déjà utilisé avant) : arithmétique décimale à précision arbitraire. Plus familier, mais plus lent, et pas naturellement adapté aux puissances de 2.
- **C. Hybride** : `decimal.js` pour la caméra, flottants locaux pour les points.

**Recommandation : A**, à valider par un prototype. Le zoom par puissances de 2 et les pixels parfaits (grille à chaque niveau) sont des valeurs dyadiques, donc exactes en A. Repli : B.

Le facteur de zoom continu (molette) est stocké comme `zLevel` (entier) + un facteur flottant entre 1 et 2, jamais comme un seul `number` de 2^k.

### 3. Comment stocker un trait qui traverse plusieurs niveaux de zoom ?

- **a. Chaque point est exact** (valeur dyadique complète). Simple, exact, mémoire raisonnable pour des traits de quelques centaines de points ; il faut recalculer les flottants relatifs à la caméra quand le niveau change (mis en cache par niveau, comme les zones de rendu).
- **b. Le trait est découpé en bouts** comme avant : un ancrage par bout, des décalages flottants locaux. Plus compact, plus de cas particuliers.

**Recommandation : a.** Un seul trait, un seul modèle, pas de découpage à gérer. Si les performances le demandent, on optimisera avec des mesures.

### 4. Quelle frontière entre moteur et applis ?

Le moteur (`packages/engine`) offre : coordonnées et caméra, conversion écran ↔ monde, zones de rendu, entrées pointeur + molette, traits en points exacts. L'application décide de ce qu'on en fait : lissage en courbe de zveceditor (`zCurve3`, `ZIndexPencilBrush` dans l'ancien code) ou grille de pixels de zpixeleditor.

### 5. Sauvegarde

Pas dans ce tronçon, mais le modèle doit être **sérialisable en JSON dès le départ** (les grands nombres s'écrivent en chaînes). Le format `.shu` de l'ancien code n'a pas été audité ; on décidera plus tard si on le lit.

## Critères de réussite du tronçon

- `packages/engine` : tests Vitest qui passent. En particulier :
  - aller-retour écran ↔ monde à de grandes profondeurs (par exemple ±1000 niveaux de zoom) sans dérive ;
  - un trait tracé en changeant de zoom garde la même forme quand on le regarde à l'échelle de départ ;
  - un point tracé à un niveau profond ne se « téléporte » pas quand on dézoome.
- `apps/zveceditor` : une page dans le navigateur où l'on trace en zoomant (molette pendant que le bouton est enfoncé), sans artefact visible, jusqu'à au moins 200 niveaux de profondeur.
- Un document de mesure simple : nombre de points par trait et temps d'une image, pour savoir si l'option 3a tient.

## Hors périmètre de ce tronçon

Objets et slots, maths, défis, sauvegarde, sélection, pixels parfaits (zpixeleditor), serveur et déploiement.
