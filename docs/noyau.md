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

## Décisions (2026-10-18)

Ce sont des hypothèses de départ : un prototype et des tests les confirmeront ou les invalideront (voir « Quand revenir sur une décision »).

### 1. Rendu : fabric.js, derrière une petite interface

On garde **fabric.js**, en version **7.4.0** (la dernière ; l'ancien code utilisait la 5.3.0, dont les patchs visaient des détails internes qu'on ne reprendra pas tels quels). Fabric calcule en flottants : le modèle exact reste de notre côté, et on lui donne des coordonnées **relatives à la caméra**.

Le rendu passe par une **petite interface** (« dessine ces traits avec cette caméra »), pour qu'un rendu Canvas 2D direct reste possible plus tard si fabric devient un frein. Le choix de fabric vaut « pour l'instant ».

### 2. Grand nombre : rationnels dyadiques en `BigInt`

Une valeur vaut `n / 2^e`, avec `n` un `BigInt` natif et `e` un entier. Zoomer d'un facteur 2 revient à changer l'exposant : exact et sans coût. Pas de dépendance. Cela colle aux pixels parfaits (une grille à chaque niveau). Repli : `decimal.js` si le prototype échoue.

Le facteur de zoom continu (molette) est stocké comme `zLevel` (entier) + un facteur flottant entre 1 et 2, jamais comme un seul `number` de 2^k.

### 3. Trait : découpé en bouts

Comme dans l'ancien code, un trait qui traverse plusieurs niveaux de zoom est découpé en **bouts**, un par échelle :

- chaque bout a un **ancrage exact** (valeur dyadique) et des **points en flottants locaux**, exprimés dans les unités de son propre niveau ;
- chaque bout devient un objet fabric dans son propre repère ; une transformation relative à la caméra le place à l'écran ;
- le dernier point d'un bout est **le même point exact** que le premier du bout suivant (pas de trou à la jonction) ;
- la jonction entre deux objets fabric ne doit pas se voir : extrémités arrondies, à vérifier visuellement.

### 4. Frontière entre moteur et applis

Le moteur (`packages/engine`) offre : coordonnées et caméra, conversion écran ↔ monde, zones de rendu, entrées pointeur + molette, traits en bouts. L'application décide de ce qu'on en fait : lissage en courbe de zveceditor (`zCurve3`, `ZIndexPencilBrush` dans l'ancien code) ou grille de pixels de zpixeleditor.

### 5. Sauvegarde

Pas dans ce tronçon, mais le modèle doit être **sérialisable en JSON dès le départ** (les grands nombres s'écrivent en chaînes). Le format `.shu` de l'ancien code n'a pas été audité ; on décidera plus tard si on le lit.

## Quand revenir sur une décision

- **Fabric 7** : si on doit le patcher en profondeur pour suivre le zoom, ou si la jonction entre bouts reste visible malgré les extrémités arrondies, on bascule sur le Canvas 2D direct (d'où l'interface de rendu).
- **BigInt dyadique** : si les opérations par image sont trop lentes à quelques centaines de points, on mesure, on met en cache par niveau, puis seulement ensuite on envisage `decimal.js`.
- **Bouts** : si le nombre de bouts explose (zoom très oscillant), on envisage de regrouper ou de re-découper.

## Critères de réussite du tronçon

- `packages/engine` : tests Vitest qui passent. En particulier :
  - aller-retour écran ↔ monde à de grandes profondeurs (par exemple ±1000 niveaux de zoom) sans dérive ;
  - un trait tracé en changeant de zoom garde la même forme quand on le regarde à l'échelle de départ ;
  - les bouts successifs partagent exactement leur point de jonction ;
  - un point tracé à un niveau profond ne se « téléporte » pas quand on dézoome.
- `apps/zveceditor` : une page dans le navigateur où l'on trace en zoomant (molette pendant que le bouton est enfoncé), sans artefact visible, jusqu'à au moins 200 niveaux de profondeur.
- Un document de mesure simple : nombre de points et de bouts par trait, et temps d'une image, pour savoir si les décisions 2 et 3 tiennent.

## Hors périmètre de ce tronçon

Objets et slots, maths, défis, sauvegarde, sélection, pixels parfaits (zpixeleditor), serveur et déploiement.
