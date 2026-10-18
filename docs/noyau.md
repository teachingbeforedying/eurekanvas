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

- chaque bout a un **ancrage exact** (valeur dyadique), un `zLevel` entier et des **points en flottants locaux** : un point local vaut `(position − ancrage) × 2^zLevel`, et sa position exacte est **définie** comme `ancrage + local × 2^-zLevel` ;
- un nouveau bout commence dès que le `zLevel` de la caméra change ; le facteur continu de la molette à l'intérieur d'un niveau n'a aucun effet, les unités locales n'en dépendent pas ;
- chaque bout devient un objet fabric dans son propre repère ; une transformation relative à la caméra le place à l'écran ;
- le dernier point d'un bout est **le même point exact** que le premier du bout suivant (pas de trou à la jonction) ;
- la jonction entre deux objets fabric ne doit pas se voir : extrémités arrondies, à vérifier visuellement.

### 4. Frontière entre moteur et applis

Le moteur (`packages/engine`) offre : coordonnées et caméra, conversion écran ↔ monde, zones de rendu, entrées pointeur + molette, traits en bouts. L'application décide de ce qu'on en fait : lissage en courbe de zveceditor (`zCurve3`, `ZIndexPencilBrush` dans l'ancien code) ou grille de pixels de zpixeleditor.

### 5. Sauvegarde

Pas dans ce tronçon, mais le modèle doit être **sérialisable en JSON dès le départ** (les grands nombres s'écrivent en chaînes). Le format `.shu` de l'ancien code n'a pas été audité ; on décidera plus tard si on le lit.

## Conventions (code dans `packages/engine/src`)

- Une position du monde est un `Dyadic` exact (`n / 2^e`, forme canonique : `n` impair). L'écran est en pixels, origine en haut à gauche.
- L'axe **y est vers le bas**, dans le monde comme à l'écran : rien à inverser.
- L'échelle (pixels écran par unité monde) vaut `2^zLevel × factor`, avec `factor` dans [1, 2). **`zLevel` augmente quand on zoome en avant.** Le sens du `zLevel` de l'ancien code n'est pas établi avec certitude : à vérifier quand on portera les pixels parfaits de zpixeleditor.
- La caméra est une valeur immuable `{ center, zLevel, factor }` : `center` est le point du monde affiché au milieu du viewport. Les fonctions (`screenToWorld`, `worldToScreen`, `pan`, `zoomAt`) renvoient de nouvelles valeurs.
- Seuls de petits décalages en pixels passent par un `number` ; ils sont convertis **exactement** en dyadiques.
- `-0` devient `0` dans la conversion, et `NaN`/`Infinity` sont refusés.

## Quand revenir sur une décision

- **Fabric 7** : si on doit le patcher en profondeur pour suivre le zoom, ou si la jonction entre bouts reste visible malgré les extrémités arrondies, on bascule sur le Canvas 2D direct (d'où l'interface de rendu).
- **BigInt dyadique** : si les opérations par image sont trop lentes à quelques centaines de points, on mesure, on met en cache par niveau, puis seulement ensuite on envisage `decimal.js`. Deux autres signaux : un besoin réel de division ou de racine exactes sur les positions du monde, ou une mesure dans un navigateur (avec fabric et des traits réalistes) qui dépasse le budget d'une image. Le retour reste abordable, car la caméra n'utilise qu'une petite interface (`add`, `sub`, `mul`, `shift`, `compare`, `fromNumber`, `toNumber`). Choix confirmé le 2026-10-18 après les premières mesures ; `decimal.js` n'a pas été mesuré, la comparaison reste possible.
- **Bouts** : si le nombre de bouts explose (zoom très oscillant), on envisage de regrouper ou de re-découper.

## Premiers résultats : nombres dyadiques et caméra (2026-10-18)

Construit : `dyadic.ts` (nombres exacts), `camera.ts` (caméra), 44 tests Vitest (21 sur les dyadiques, 20 sur la caméra, 3 sur les prémisses), build TypeScript strict sans erreur. Pas de fabric, pas de trait, pas d'interface.

**Ce que les tests montrent.**
- Les aller-retours écran → monde → écran sont justes à moins de 1e-9 pixel de −1000 à +1000 niveaux de zoom, avec des centres de 1 000 bits.
- `zoomAt` garde **exactement** le point sous le curseur (égalité des dyadiques, pas une tolérance) après 5 000 zooms avant (environ 2^687) puis 5 000 zooms arrière.
- Les ratios extrêmes (1e300, 1e-300) ne débordent pas, car le ratio est découpé en puissance de 2 et partie dans [1, 2).
- Vérifié par une mutation volontaire : en cassant le calcul du nouveau centre dans `zoomAt`, trois tests échouent. Les tests détectent donc bien une erreur d'ancrage.

**Vitesse** (Node 24, une seule machine, quelques dizaines de passes après échauffement ; script jetable, non conservé). Hypothèse « BigInt dyadique » : tenable pour ce tronçon, sans cache par niveau.

| Opération | zLevel −1000 | zLevel 0 | zLevel +1000 |
| --------- | ------------ | -------- | ------------ |
| `worldToScreen`, 1 000 points | 3,2 ms | 3,0 ms | 1,7 ms |
| `screenToWorld`, 1 000 points | 1,0 ms | 1,1 ms | 1,1 ms |

Soit 2 à 3 µs par point avec un centre de 1 000 bits. `zoomAt` : 6,5 µs par appel (5 000 zooms consécutifs en 32 ms). Ce n'est pas mesuré dans un navigateur, ni avec fabric.

**Taille d'un centre.** Elle dépend de l'**étendue** de la position (du chiffre binaire le plus gros au plus fin), pas de la profondeur atteinte :
- zoomer vers un point *hors du centre de l'écran* l'allonge d'environ un bit par niveau : 191, 327, 464, 603 puis 738 bits après 1 000 à 5 000 zooms (de `zLevel` 137 à 687), soit environ `zLevel + 54` bits ;
- dézoomer autour du même point la raccourcit (10 bits de retour au niveau 0) ;
- zoomer autour du milieu de l'écran ne change pas le centre (0 bit), et un déplacement à 500 niveaux de profondeur n'y ajoute que 52 bits, quelle que soit la profondeur ;
- 738 bits, c'est une centaine d'octets : sans conséquence à ce stade. Si besoin, on pourra arrondir le centre à quelques dizaines de bits sous la taille d'un pixel.

(Cette section corrige une hypothèse du plan de travail, qui supposait une taille croissant avec la profondeur et ne rétrécissant jamais.)

**Limite de précision de l'écran.** Une coordonnée écran est un `number` : près de 400, son pas est d'environ 6e-14 pixel. Un point à moins de cet écart du milieu est donc affiché *au* milieu, même si son décalage exact est connu. C'est sans conséquence pour l'affichage, mais ça compte pour les tests : un premier test de dézoom comparait des distances à l'écran et échouait (1,7e-9 d'écart relatif) parce qu'il mesurait cet arrondi et non la caméra. Il ne compare maintenant les distances que lorsqu'elles sont mesurables.

**Pas encore vérifié** : le comportement avec fabric 7, dans un navigateur, avec des traits en bouts, et la lecture du `zLevel` de l'ancien code.

## Sérialisation et export

La question posée : ces traits « un peu particuliers » peuvent-ils être sauvegardés et lus ailleurs, ou seul notre logiciel peut-il les afficher ? Trois niveaux.

1. **Format natif, sans perte** : JSON versionné `eurekanvas/stroke`, spécifié dans [format-trait.md](./format-trait.md). Ancrages exacts écrits en texte (`"3/2^-4"`), points en nombres. Tout langage qui sait lire de grands entiers peut le lire, donc des lecteurs tiers sont possibles. En pratique, notre moteur sera le seul à afficher un trait **en entier à toute profondeur**.
2. **Exports vers les formats courants, avec perte assumée** (pas encore faits) : instantané d'une vue en SVG, PNG ou PDF, en projetant les bouts visibles ; vidéo ou GIF du zoom, qui raconte la plongée telle qu'elle a été dessinée ; pour du raster, une pyramide de tuiles bornée en profondeur. À ma connaissance (non vérifié), les formats courants reposent sur des flottants 32 ou 64 bits : un trait de 700 niveaux n'y tient pas en un seul repère, d'où la perte. Un instantané ne contient que ce qui est visible à l'échelle de la vue (ce qui est bien plus petit qu'un pixel, ou hors de l'écran, disparaît) ; la fourchette de niveaux utile dépend de la précision de l'application qui ouvrira le fichier, et n'a pas été mesurée.
3. **Visionneur web** : le moteur est du JavaScript, donc un lien vers le site suffit pour que quelqu'un voie le trait en entier.

Un export exige un style de trait (couleur, épaisseur), absent du modèle pour l'instant : il viendra avec le rendu.

## Résultats : traits découpés en bouts (2026-10-18)

Construit : `stroke.ts` (modèle, enregistreur, projection, JSON), 24 tests ; 68 tests au total, build TypeScript strict sans erreur. Toujours sans fabric.

**Ce que les tests montrent.**
- Un trait tracé en zoomant (pointeur sur un cercle, puis pointeur qui erre) à travers 211 niveaux garde sa forme : l'écart entre le point sous le pointeur et le point enregistré reste sous 1e-9 unité locale.
- Il y a exactement un bout par niveau traversé, en zoom avant comme en zoom arrière.
- Les jonctions sont exactement partagées (égalité des dyadiques).
- Les coordonnées locales restent petites à n'importe quelle profondeur, ce qui est le but des bouts. Plus grande valeur mesurée sur 3 000 événements et 211 niveaux : 112 pour un pointeur qui tourne en cercle, 1 255 dans le pire cas (le pointeur saute à travers tout l'écran à chaque événement). Les tests exigent moins de 5 000.
- Un va-et-vient du zoom autour d'une frontière de niveau crée un bout par événement. C'est le pire cas de la règle simple « un bout par niveau » ; il reste exact. Une hystérésis pourra l'atténuer si fabric montre un problème.
- Contrôle par mutation : en ancrant le nouveau bout sur le mauvais point, 10 tests échouent ; en inversant le signe du niveau dans `pointWorld`, 9 échouent (chaque modification a été défaite ensuite).

**Vitesse** (Node 24, une machine, script jetable non conservé ; trait de 10 000 points, 1 375 niveaux de profondeur) :

| Opération | Coût |
| --------- | ---- |
| `addPoint` | 1,8 µs par point |
| `strokeWorldPoints`, 10 000 points | 13 ms |
| `strokeToJSON` + `JSON.stringify` | 7,6 ms |
| `projectBout`, 212 bouts (une image) | 0,37 ms (1,8 µs par bout) |

**Taille du JSON** pour ce trait (1 376 bouts, 11 375 points) : 1 082 Kio, dont 638 Kio pour les ancrages (59 %) ; 403 Kio avec gzip. Les ancrages sont redondants (celui d'un bout est le dernier point du précédent) : une version future pourrait les omettre et diviser la taille par deux environ. La version 1 les garde pour que chaque bout soit lisible seul.

**Erreur de la projection en flottants** (`origin + local × scale`) selon l'écart de niveaux entre la caméra et le bout, pire cas sur 30 positions à l'écran, en pixels :

| Étendue du bout | écart 0 | 10 | 20 | 30 | 40 | 50 |
| --------------- | ------- | -- | -- | -- | -- | -- |
| 10 unités locales | 0 | 2e-12 | 2e-9 | 2e-6 | 2e-3 | 1,9 |
| 100 unités locales | 6e-14 | 1,5e-11 | 2,5e-8 | 2,8e-5 | 1,6e-2 | 20 |
| 1 000 unités locales | 2e-13 | 2e-10 | 2e-7 | 2e-4 | 0,24 | 350 |

L'erreur est multipliée par environ 1 000 tous les 10 niveaux. **Règle proposée** : projeter un bout par la voie rapide (`projectBout`) quand l'écart de niveaux est d'au plus 30 (erreur sous 3e-4 px pour des bouts de moins de 1 000 unités locales), et au-delà projeter chaque point par la voie exacte (`pointWorld` puis `worldToScreen`, environ 3 µs par point). Le seuil sera fixé avec les zones de rendu.

**Leçons de la mise au point, pour mémoire.**
- Une première mesure de cette erreur donnait 0 partout : le point était pile au milieu d'un écran de taille paire, donc aligné sur la grille des flottants, et l'arrondi se compensait. La mesure ci-dessus utilise un écran de taille impaire et 30 positions quelconques.
- Trois tests échouaient d'abord par erreur de test (pointeur collé à un coin de l'écran, point de départ du zoom arrière, va-et-vient qui ne franchissait aucune frontière de niveau), pas par défaut du modèle.
- Un calcul fait à la collecte des tests (dans le corps d'un `describe`) faisait disparaître tous les tests du fichier quand il échouait ; il est maintenant dans un `beforeAll`.

**Pas encore vérifié** : fabric, un navigateur, un vrai pointeur, la sensation de dessin « comme dans l'ancienne version ».

## Suite : de quoi tester à la main

Rien de ce qui précède ne se teste encore avec la souris. L'objectif de Sébastien est un moteur qui se comporte **comme l'ancien** quand on trace en zoomant, et il jugera sur pièce. L'étape suivante est donc une page jouable dans `apps/zveceditor` : tracer avec la souris, zoomer à la molette autour du pointeur y compris pendant le tracé, afficher le trait par fabric 7. Gestes de l'ancienne version à reprendre ou à adapter (README de `a-user-interface`) : tracer en gardant la touche `²` (ou `` ` ``) enfoncée et en cliquant ; molette pour zoomer, avec « l'index fait défiler la molette pendant que le majeur clique » pour tracer et zoomer en même temps.

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
