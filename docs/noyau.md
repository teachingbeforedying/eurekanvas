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
- un trait tracé pendant un changement d'échelle est **découpé en sections**, une par échelle (`DrawingSession` → `DrawingBout` dans l'ancien code).

## Décisions (2026-10-18)

Ce sont des hypothèses de départ : un prototype et des tests les confirmeront ou les invalideront (voir « Quand revenir sur une décision »).

### 1. Rendu : fabric.js, derrière une petite interface

On garde **fabric.js**, en version **7.4.0** (la dernière ; l'ancien code utilisait la 5.3.0, dont les patchs visaient des détails internes qu'on ne reprendra pas tels quels). Fabric calcule en flottants : le modèle exact reste de notre côté, et on lui donne des coordonnées **relatives à la caméra**.

Le rendu passe par une **petite interface** (« dessine ces traits avec cette caméra »), pour qu'un rendu Canvas 2D direct reste possible plus tard si fabric devient un frein. Le choix de fabric vaut « pour l'instant ».

### 2. Grand nombre : rationnels dyadiques en `BigInt`

Une valeur vaut `n / 2^e`, avec `n` un `BigInt` natif et `e` un entier. Zoomer d'un facteur 2 revient à changer l'exposant : exact et sans coût. Pas de dépendance. Cela colle aux pixels parfaits (une grille à chaque niveau). Repli : `decimal.js` si le prototype échoue.

Le facteur de zoom continu (molette) est stocké comme `zLevel` (entier) + un facteur flottant entre 1 et 2, jamais comme un seul `number` de 2^k.

### 3. Trait : découpé en sections

Comme dans l'ancien code, un trait qui traverse plusieurs niveaux de zoom est découpé en **sections**, une par échelle :

- chaque section a un **ancrage exact** (valeur dyadique), un `zLevel` entier et des **points en flottants locaux** : un point local vaut `(position − ancrage) × 2^zLevel`, et sa position exacte est **définie** comme `ancrage + local × 2^-zLevel` ;
- une nouvelle section commence dès que le `zLevel` de la caméra change ; le facteur continu de la molette à l'intérieur d'un niveau n'a aucun effet, les unités locales n'en dépendent pas ;
- chaque point porte aussi son **épaisseur** (`width`, en unités locales), choisie au moment du tracé pour que le trait fasse un nombre constant de pixels à l'écran à cet instant (`pixels / facteur de la caméra`) ; voir « Épaisseur : un dégradé continu » ;
- chaque section devient un objet fabric (un `Path`) dans son propre repère ; une transformation relative à la caméra le place à l'écran ;
- le dernier point d'une section est **le même point exact** que le premier de la section suivante, avec la même épaisseur exprimée dans la nouvelle unité (pas de trou ni de marche à la jonction) ;
- la jonction entre deux objets fabric ne se voit pas : extrémités arrondies (vérifié dans le navigateur).

### Épaisseur : un dégradé continu

L'ancien code coupait le trait **à chaque cran de molette** pendant le tracé (`isBreakingBout = true`, L33762) pour recalculer l'épaisseur : l'épaisseur y est constante par morceau, avec des sauts entre morceaux. Sébastien a demandé mieux : un dégradé qui ne laisse pas voir les crans.

- Une largeur par point, et **aucune coupure par cran de molette** : on ne coupe qu'au changement de niveau entier.
- Deux points consécutifs sont reliés par l'**enveloppe convexe de deux disques** de diamètres `width` (`strokeOutline`, dans `packages/engine/src/outline.ts`) : une capsule effilée. Un point seul est un disque. Le trait est l'union de ces formes : extrémités et jonctions rondes, épaisseur qui varie linéairement entre deux points.
- Effet : un cran de molette entre deux positions du pointeur donne un affinement progressif sur le segment suivant. Vu de loin, le trait s'affine doucement quand on plonge.
- Écartés : des segments à largeur moyenne et extrémités rondes (marches visibles) ; un sous-échantillonnage des segments (approximatif et coûteux).
- **Non inclus** : animer le zoom sur ~100 ms au lieu de le faire d'un coup. Cela changerait le ressenti par rapport à l'ancienne version ; à décider après essai.

### 4. Frontière entre moteur et applis

Le moteur (`packages/engine`) offre : coordonnées et caméra, conversion écran ↔ monde, zones de rendu, entrées pointeur + molette, traits en sections. L'application décide de ce qu'on en fait : lissage en courbe de zveceditor (`zCurve3`, `ZIndexPencilBrush` dans l'ancien code) ou grille de pixels de zpixeleditor.

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

- **Fabric 7** : si on doit le patcher en profondeur pour suivre le zoom, ou si la jonction entre sections reste visible malgré les extrémités arrondies, on bascule sur le Canvas 2D direct (d'où l'interface de rendu).
- **BigInt dyadique** : si les opérations par image sont trop lentes à quelques centaines de points, on mesure, on met en cache par niveau, puis seulement ensuite on envisage `decimal.js`. Deux autres signaux : un besoin réel de division ou de racine exactes sur les positions du monde, ou une mesure dans un navigateur (avec fabric et des traits réalistes) qui dépasse le budget d'une image. Le retour reste abordable, car la caméra n'utilise qu'une petite interface (`add`, `sub`, `mul`, `shift`, `compare`, `fromNumber`, `toNumber`). Choix confirmé le 2026-10-18 après les premières mesures ; `decimal.js` n'a pas été mesuré, la comparaison reste possible.
- **Sections** : si le nombre de sections explose (zoom très oscillant), on envisage de regrouper ou de re-découper.

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

**Pas encore vérifié** : le comportement avec fabric 7, dans un navigateur, avec des traits en sections, et la lecture du `zLevel` de l'ancien code.

## Sérialisation et export

La question posée : ces traits « un peu particuliers » peuvent-ils être sauvegardés et lus ailleurs, ou seul notre logiciel peut-il les afficher ? Trois niveaux.

1. **Format natif, sans perte** : JSON versionné `eurekanvas/stroke`, spécifié dans [stroke-format.md](./stroke-format.md). Ancrages exacts écrits en texte (`"3/2^-4"`), points en nombres. Tout langage qui sait lire de grands entiers peut le lire, donc des lecteurs tiers sont possibles. En pratique, notre moteur sera le seul à afficher un trait **en entier à toute profondeur**.
2. **Exports vers les formats courants, avec perte assumée** (pas encore faits) : instantané d'une vue en SVG, PNG ou PDF, en projetant les sections visibles ; vidéo ou GIF du zoom, qui raconte la plongée telle qu'elle a été dessinée ; pour du raster, une pyramide de tuiles bornée en profondeur. À ma connaissance (non vérifié), les formats courants reposent sur des flottants 32 ou 64 bits : un trait de 700 niveaux n'y tient pas en un seul repère, d'où la perte. Un instantané ne contient que ce qui est visible à l'échelle de la vue (ce qui est bien plus petit qu'un pixel, ou hors de l'écran, disparaît) ; la fourchette de niveaux utile dépend de la précision de l'application qui ouvrira le fichier, et n'a pas été mesurée.
3. **Visionneur web** : le moteur est du JavaScript, donc un lien vers le site suffit pour que quelqu'un voie le trait en entier.

Un export exige un style de trait (couleur, épaisseur), absent du modèle pour l'instant : il viendra avec le rendu.

## Résultats : traits découpés en sections (2026-10-18)

Construit : `stroke.ts` (modèle, enregistreur, projection, JSON), 24 tests ; 68 tests au total, build TypeScript strict sans erreur. Toujours sans fabric.

**Ce que les tests montrent.**
- Un trait tracé en zoomant (pointeur sur un cercle, puis pointeur qui erre) à travers 211 niveaux garde sa forme : l'écart entre le point sous le pointeur et le point enregistré reste sous 1e-9 unité locale.
- Il y a exactement une section par niveau traversé, en zoom avant comme en zoom arrière.
- Les jonctions sont exactement partagées (égalité des dyadiques).
- Les coordonnées locales restent petites à n'importe quelle profondeur, ce qui est le but des sections. Plus grande valeur mesurée sur 3 000 événements et 211 niveaux : 112 pour un pointeur qui tourne en cercle, 1 255 dans le pire cas (le pointeur saute à travers tout l'écran à chaque événement). Les tests exigent moins de 5 000.
- Un va-et-vient du zoom autour d'une frontière de niveau crée une section par événement. C'est le pire cas de la règle simple « une section par niveau » ; il reste exact. Une hystérésis pourra l'atténuer si fabric montre un problème.
- Contrôle par mutation : en ancrant la nouvelle section sur le mauvais point, 10 tests échouent ; en inversant le signe du niveau dans `pointWorld`, 9 échouent (chaque modification a été défaite ensuite).

**Vitesse** (Node 24, une machine, script jetable non conservé ; trait de 10 000 points, 1 375 niveaux de profondeur) :

| Opération | Coût |
| --------- | ---- |
| `addPoint` | 1,8 µs par point |
| `strokeWorldPoints`, 10 000 points | 13 ms |
| `strokeToJSON` + `JSON.stringify` | 7,6 ms |
| `projectSection`, 212 sections (une image) | 0,37 ms (1,8 µs par section) |

**Taille du JSON** pour ce trait (1 376 sections, 11 375 points) : 1 082 Kio, dont 638 Kio pour les ancrages (59 %) ; 403 Kio avec gzip. Les ancrages sont redondants (celui d'une section est le dernier point de la précédente) : une version future pourrait les omettre et diviser la taille par deux environ. La version 1 les garde pour que chaque section soit lisible seule.

**Erreur de la projection en flottants** (`origin + local × scale`) selon l'écart de niveaux entre la caméra et la section, pire cas sur 30 positions à l'écran, en pixels :

| Étendue de la section | écart 0 | 10 | 20 | 30 | 40 | 50 |
| --------------- | ------- | -- | -- | -- | -- | -- |
| 10 unités locales | 0 | 2e-12 | 2e-9 | 2e-6 | 2e-3 | 1,9 |
| 100 unités locales | 6e-14 | 1,5e-11 | 2,5e-8 | 2,8e-5 | 1,6e-2 | 20 |
| 1 000 unités locales | 2e-13 | 2e-10 | 2e-7 | 2e-4 | 0,24 | 350 |

L'erreur est multipliée par environ 1 000 tous les 10 niveaux. **Règle proposée** : projeter une section par la voie rapide (`projectSection`) quand l'écart de niveaux est d'au plus 30 (erreur sous 3e-4 px pour des sections de moins de 1 000 unités locales), et au-delà projeter chaque point par la voie exacte (`pointWorld` puis `worldToScreen`, environ 3 µs par point). Le seuil sera fixé avec les zones de rendu.

**Cette règle est remplacée par la mesure dans le navigateur** (section « Résultats : page jouable » plus bas) : le canvas d'un navigateur calcule en simple précision et se dégrade bien avant les nombres JavaScript.

**Leçons de la mise au point, pour mémoire.**
- Une première mesure de cette erreur donnait 0 partout : le point était pile au milieu d'un écran de taille paire, donc aligné sur la grille des flottants, et l'arrondi se compensait. La mesure ci-dessus utilise un écran de taille impaire et 30 positions quelconques.
- Trois tests échouaient d'abord par erreur de test (pointeur collé à un coin de l'écran, point de départ du zoom arrière, va-et-vient qui ne franchissait aucune frontière de niveau), pas par défaut du modèle.
- Un calcul fait à la collecte des tests (dans le corps d'un `describe`) faisait disparaître tous les tests du fichier quand il échouait ; il est maintenant dans un `beforeAll`.

**Pas encore vérifié** : fabric, un navigateur, un vrai pointeur, la sensation de dessin « comme dans l'ancienne version ».

## Résultats : page jouable et rendu fabric (2026-10-18)

L'objectif de Sébastien est un moteur qui se comporte **comme l'ancien** quand on trace en zoomant ; il jugera sur pièce, avec cette page.

**Construit.** `packages/engine` : `outline.ts` (contour d'un trait d'épaisseur variable), `render.ts` (l'interface `Renderer` et `selectDrawableSections`), largeur par point, renommage `bout` → `section`. `packages/renderer-fabric` : `FabricRenderer` (fabric 7.4.0, un `StaticCanvas`, un `Path` par section, gardé en cache tant que la section existe). `apps/zveceditor` : `Editor` (comportement de l'outil, sans DOM, testé) et `main.ts` (événements du navigateur, boucle d'images, affichage de contrôle). 115 tests (94 pour le moteur, 21 pour l'éditeur), build TypeScript strict sans erreur.

**Gestes.** Bouton gauche : tracer. Molette : zoomer autour du pointeur, y compris en traçant (formule de l'ancien code : facteur `1 − deltaY / 500`, borné ; elle est additive en `deltaY`, donc trois crans d'un coup valent ×1,6 et trois crans séparés ×1,73). Bouton droit, bouton du milieu, ou Espace + gauche : déplacer la vue. `Ctrl+Z` : annuler le dernier trait. `0` : revenir à la vue de départ. Les touches `²` et `` ` `` de l'ancienne version ne sont pas reprises.

**Mesures dans le navigateur** (Chrome dans le panneau Browser, écran à l'échelle 1,5, serveur de développement Vite ; lecture des pixels du canvas) :

1. **Placement.** Un disque de 20 px posé en (100, 50) tombe exactement sur l'écran en (500, 350) : la transformation par `pathOffset` et `applyTransformToObject` est la bonne.
2. **Dégradé.** Un trait dont l'épaisseur passe linéairement de 4 à 24 px sur 600 px, mesuré par la couverture des pixels (précis sous le pixel) : écart maximal de 0,003 px, et variation de 0,329 à 0,335 px par pas de 10 px (0,333 attendu). Aucune marche.
3. **Précision du canvas.** Erreur, en pixels, de la position de l'extrémité d'un trait fin, selon l'écart de niveaux (le plancher de 0,07 px vient de la taille du pixel de l'écran) :

| Étendue de la section | écart 6 à 12 | 13 | 14 | 16 | 18 |
| --------------------- | ------------ | -- | -- | -- | -- |
| 10 unités locales | 0,07 | 0,07 | 0,07 | 0,07 | 0,07 |
| 100 unités locales | 0,07 | 0,07 | 0,07 | −0,6 | 0,07 (au hasard) |
| 1 000 unités locales | 0,07 | −0,6 | −0,6 | −3,9 | −22,6 (trait absent de la colonne mesurée) |

   Avec 100 unités locales, l'erreur atteint −1,3 px à 20 niveaux, −97 px à 24, et rien n'est dessiné à 30 et 40. Ce n'est donc pas une limite en niveaux mais en **étendue en pixels** (distance de l'ancrage à l'extrémité, multipliée par l'échelle) : sous environ 6 millions de pixels l'erreur reste sous 0,1 px, vers 10 millions elle vaut 0,6 px. Le canvas du navigateur calcule en simple précision. `selectDrawableSections` applique donc `DEFAULT_MAX_REACH_PIXELS = 4e6`, plus `maxLevelGap = 24` comme dans l'ancien code.
4. **Un essai de placement près de l'écran.** En posant l'objet fabric sur un point de la section proche de l'écran (au lieu de son ancrage), l'erreur reste au plancher de mesure jusqu'à 80 niveaux d'écart, pour des traits fins. Mais en vrai, un trait de 3 px dessiné à un niveau devient, vu 12 niveaux plus profond, une bande d'environ 12 000 px de large, dont les bords sont des arcs de très grand rayon : le même problème de précision revient pour ces bords. Il faudrait calculer le contour en double précision et le découper au cadre de l'écran avant de le donner au canvas. **Non fait**, hors du périmètre de cette étape.

**Conséquence par rapport à l'ancienne version, à connaître.** L'ancien code dessinait les objets jusqu'à 24 niveaux plus grands que l'écran. Ici, une section de 100 unités locales n'est plus dessinée au-delà d'environ 14 niveaux de zoom avant, et une de 1 000 unités au-delà d'environ 12. Quand on zoome plus profondément dans un trait dessiné plus tôt, il disparaît (écran blanc), là où l'ancienne version l'aurait montré comme une grande masse noire. Quand on dessine en zoomant, ce n'est pas visible (les sections récentes sont proches du niveau courant), c'est quand on revient zoomer dans un dessin. À juger à l'usage.

**Vérifié à l'usage** (page lancée dans le panneau Browser) :
- un trait au vrai glisser de la souris : 1 trait, au bon endroit ;
- une spirale tracée en zoomant (700 événements, ×1,012 chacun) : 13 sections, trait lisse dont l'épaisseur diminue progressivement ;
- une plongée de 130 niveaux en traçant (800 événements, ×1,12 chacun, injectés par le chemin normal de la page) : 131 sections et 931 points, traités en 13 ms ; la page n'en dessine que 4 à ce niveau ; bords lisses, pas de coupure aux jonctions ;
- le dézoom de ce trait, de 130 niveaux jusqu'à −6, en passant par 100, 60 et 8 : le trait reste lisse et s'épaissit vers les sections anciennes, puis se réduit à un point ;
- la vraie molette et la vraie touche `0`, via les outils du panneau ; aucune erreur dans la console.

**Pas vérifié** : le déplacement de la vue avec les boutons droit et milieu, ou avec Espace (tests unitaires seulement) ; le tactile et le stylet ; Firefox et Safari ; une plongée de 200 niveaux ; et surtout la sensation de dessin « comme dans l'ancienne version », qui revient à Sébastien.

**Suite possible, selon ce qu'il constatera.** (1) Dessiner les sections lointaines : contour en double précision découpé au cadre, pour retrouver et dépasser les 24 niveaux de l'ancien. (2) Animer le zoom. (3) Reprendre les gestes `²` et molette de l'ancien. (4) Sauvegarder et charger un dessin (le format JSON existe, pas de bouton).

## Le stylo lissé et le déplacement de la vue en traçant (2026-10-18)

Premiers retours de Sébastien sur la page jouable : « très satisfaisant », avec deux remarques. (1) Le trait tremble avec la souris : il veut garder le mode brut et avoir **en plus** un mode lisse, plus tendu. (2) Dans l'ancienne version, bouton gauche enfoncé, on pouvait appuyer sur le bouton droit pour déplacer la vue, puis continuer son trait.

**Lissage : une corde** (`apps/zveceditor/src/rope.ts`). Le pinceau est attaché au pointeur par une corde de longueur fixe, **en pixels d'écran** (c'est là que la main tremble). Tant que le pointeur reste à moins d'une longueur de corde, le pinceau ne bouge pas ; au-delà, il est tiré en ligne droite vers le pointeur jusqu'à être exactement à une longueur de lui. Le trait suit donc le pointeur avec un retard d'au plus une longueur de corde, et se termine là où l'on relâche (un dernier segment droit ; remplacé le 2026-10-25 : le trait s'arrête au pinceau, voir « Fin de trait et corde qui suit la vitesse »). Pour dessiner plus fin, on zoome : un écran infini rend ce réglage naturel. Longueurs : 4, 8, 16, 32, 64, 128 px ; 16 au départ ; 0 = stylo brut (comportement d'avant). `S` bascule, `[` et `]` règlent, le choix est mémorisé par le navigateur. Choix fait avec Sébastien : corde en temps réel, mode lisse au démarrage.

La corde suit le dessin quand la vue change : un zoom autour du pointeur ramène le pinceau à `pivot + (pinceau − pivot) × ratio`, un déplacement de la vue le décale d'autant. Le bout du trait reste ainsi sur le même endroit du dessin.

**Mesures** (même séquence de tremblements, ±4,5 px à 3 px d'intervalle, une droite de 410 px ; rugosité = écart-type de la position verticale des points enregistrés, dans le navigateur) :

| Stylo | rugosité |
| ----- | -------- |
| brut | 2,5 px |
| corde de 16 px | 0,66 px |
| corde de 32 px | 0,42 px |

Soit 3,8 fois plus lisse à 16 px. Les tests (`rope.test.ts`, `editor-pen.test.ts`) obtiennent au moins un facteur 3 avec 32 px sur une autre séquence. **La corde supprime le tremblement, pas les points** : tant que le pointeur avance, le pinceau avance au même rythme, donc le nombre de points ne baisse pas (une de mes hypothèses de test était fausse là-dessus).

**Déplacer la vue en traçant** (`Editor`). L'état est maintenant fait de trois choses indépendantes : un trait ouvert, des boutons de déplacement (droit et milieu), et Espace + gauche. Appuyer sur le bouton droit pendant un tracé met le trait en pause (il reste ouvert, rien n'est ajouté) ; la vue suit le pointeur ; au relâchement, le trait reprend **depuis son propre bout**, sans saut : le contenu suit le pointeur, donc le dernier point tracé et le pointeur se déplacent du même décalage. Appuyer sur le bouton gauche pendant un déplacement est ignoré ; relâcher le gauche pendant un déplacement ferme le trait.

**Piège du navigateur, traité.** Quand on appuie sur un second bouton de la souris alors qu'un premier est enfoncé, le navigateur n'envoie **pas** de `pointerdown` : il envoie un `pointermove` dont le masque `event.buttons` a changé (idem au relâchement d'un seul des deux). `main.ts` compare donc le masque à chaque événement de pointeur (`controls.ts`, `buttonChanges`) au lieu de se fier à `event.button`.

**Vérifié dans le navigateur** : la touche `S` (vraie touche) bascule et se mémorise, `[` et `]` aussi, `Ctrl+Z` aussi ; les trois stylos comparés sur une capture (brut, 16 px, 32 px) ; la séquence d'événements d'un geste gauche + droit (masques `buttons` 1, 3, 1) : le trait reste ouvert, ne grandit pas pendant le déplacement, la vue suit le pointeur de (100, 60), le trait reprend sans saut (50 px au plus entre deux points) ; une plongée de 163 niveaux avec la corde de 32 px (164 sections, 1 160 points, aucune erreur).

**Pas vérifié** : le geste réel avec deux boutons de souris tenus ensemble (les outils du panneau ne peuvent pas le faire : seule la séquence d'événements a été rejouée) ; Firefox et Safari ; la sensation du retard de la corde à la main, à juger par Sébastien. **Écarté** : lisser le trait après coup par ajustement de courbes (pas de retard mais la forme change au relâchement ; chantier plus lourd, notamment à travers plusieurs niveaux de zoom).

## Fin de trait et corde qui suit la vitesse (2026-10-25)

Deux demandes de Sébastien. (1) Plus de segment droit à la fin d'un trait lissé. (2) Pouvoir dessiner des épingles à cheveux de rayon arbitraire : la corde fixe arrondit tout virage plus serré qu'elle.

**La fin de trait : rien n'est ajouté au relâchement.** Le trait s'arrête là où est le pinceau, avec les deux cordes : ce qu'on voit pendant le tracé est ce qu'on obtient (« il faut que ce qui est visible soit ce que l'on obtient à la fin », Sébastien, après essai). Un geste plus court que la corde ne laisse qu'un point. Avec la corde-vitesse, la corde vaut 4 px pendant les 50 premières ms, donc seul un geste de moins de 4 px est concerné.

Le chemin pour y arriver, pour mémoire :
- Le pinceau est toujours tiré vers le pointeur : sa vitesse pointe vers lui (une courbe de poursuite). Au relâchement, le pointeur est donc sur la tangente du pinceau (mesuré : 0,000° sur des cercles de 100 à 400 px, avec des cordes de 16 à 128 px et des pas de 1 à 8 px). Une courbe tangente au trait qui tourne d'un seul côté ne peut pas rejoindre un point de sa tangente : un arc tangent qui finit au pointeur est une droite.
- Une première version continuait la courbure du trait et finissait à côté du pointeur. La courbure était lue sur trois points du chemin du pinceau, espacés de deux fois la longueur de la fin. Avec un espacement de la moitié seulement, le tremblement restant dans le chemin courbait la fin jusqu'à 7 px sur une ligne droite tremblée (±3 px). Après essai, Sébastien l'a écartée au profit de la règle ci-dessus, et le code a été supprimé (il n'avait pas été commité).

**La corde qui suit la vitesse** (troisième mode). Sa longueur est la distance entre le pointeur et sa position 50 ms plus tôt (interpolée), bornée entre 4 et 128 px : un retard constant en temps. Une main rapide donne une corde longue et un trait tendu ; une main lente, une corde courte, et l'on serre un virage en ralentissant. Tant que les positions du pointeur ne couvrent pas le retard (début du trait, reprise après un déplacement de la vue), la longueur ne change pas : pas de rattrapage en ligne droite à la reprise. Le zoom ne touche pas à ces positions, puisque la main ne bouge pas.

Écart entre le sommet du trait et celui du pointeur, en pixels, pour une épingle dont le virage est pris à 100 px/s (simulation, un événement toutes les 4 ms) :

| Rayon du virage | corde fixe 16 | corde fixe 64 | vitesse, 25 ms | vitesse, 50 ms | vitesse, 100 ms |
| --------------- | ------------- | ------------- | -------------- | -------------- | --------------- |
| 5 px | 15,1 | 63,8 | 1,7 | 2,4 | 7,1 |
| 10 px | 11,6 | 63,1 | 0,9 | 1,3 | 4,7 |
| 20 px | 6,5 | 60,2 | 0,4 | 0,7 | 2,6 |

Dans le navigateur (événements synthétiques minutés, virage de 10 px de rayon, lecture des pixels du canvas) : 1 px avec la corde-vitesse à 50 ms, 12 px avec la corde fixe de 16. Un arc tracé à 750 px/s puis relâché : le trait a le même nombre de points avant et après le relâchement (159), et s'arrête à une longueur de corde (36,5 px) du point de relâchement.

**Freinage.** Une souris immobile n'envoie pas d'événement, donc la corde ne raccourcit pas quand la main s'arrête. Aucun segment droit n'a été mesuré au freinage (de 1 000 px/s à l'arrêt en 30 à 200 ms, sur un cercle) ; le trait s'arrête alors à 11 à 39 px du point de relâchement. **Mais** un appareil qui envoie des événements à l'arrêt (stylet ou tactile, non vérifié) ferait rattraper le pointeur en ligne droite : jusqu'à 41 px mesurés en simulation. Sébastien a choisi d'essayer sans limiter la vitesse à laquelle la corde raccourcit.

**Touches.** `S` passe du stylo brut à la corde fixe, puis à la corde-vitesse. `[` et `]` règlent la longueur de la corde fixe (4 à 128 px) ou le retard (25 à 400 ms) ; ils marchent aussi avec AltGr (clavier AZERTY, que le navigateur signale comme Ctrl+Alt). Le panneau affiche la longueur de la corde pendant un tracé. Les réglages sont mémorisés sous `zveceditor.pen` ; l'ancienne clé `zveceditor.rope` est ignorée.

**Contrôle par mutation** : 5 modifications volontaires (un rattrapage du pointeur au relâchement, les positions gardées après un déplacement de la vue, pas de minimum de 4 px, pas d'interpolation, une corde-vitesse qui ne suit jamais la main) ; chacune fait échouer au moins un test.

**Pas vérifié** : le stylet et le tactile ; Firefox et Safari ; un zoom en plein tracé avec la corde-vitesse dans le navigateur (tests unitaires seulement).

## Enregistrer et ouvrir un dessin (2026-10-25)

Demande de Sébastien : ne plus perdre un dessin au rechargement, et pouvoir le garder dans un fichier. L'assemblage de plusieurs fichiers vient après la sélection (voir « Suite »).

**Le format** `eurekanvas/drawing`, version 1 ([drawing-format.md](./drawing-format.md), en anglais pour des lecteurs tiers) : la vue (centre exact, `zLevel`, `factor`) et la liste des traits, chacun un document `eurekanvas/stroke` complet. Code : `packages/engine/src/drawing.ts`. L'aller-retour par du vrai texte JSON est exact (ancrages et centre égaux en dyadiques) pour un trait de 600 niveaux.

**L'enregistrement automatique** se fait dans IndexedDB plutôt que dans `localStorage`, limité à environ 5 Mo (un seul trait de 1 375 niveaux pèse 1,3 Mo). Il a lieu 500 ms après la dernière modification (trait, ajout, effacement, annulation, molette, déplacement, `0`) et quand la page passe en arrière-plan. Les traits et la vue reviennent à l'ouverture de la page. Pour ne rien perdre :
- rien n'est enregistré avant d'avoir relu le dessin gardé, sinon la page vide du démarrage l'écraserait ;
- un trait tracé pendant ce chargement est gardé, après les traits relus ;
- un dessin gardé illisible (version inconnue, texte abîmé) est mis de côté sous `unreadable-<date>`, jamais écrasé ; s'il ne peut même pas être mis de côté, l'enregistrement automatique s'arrête ;
- sans IndexedDB, la page marche sans enregistrement automatique, et le panneau le dit.

**Commandes** (choix de Sébastien) :
- `Ctrl+S` télécharge une copie, `drawing-AAAA-MM-JJ-HHMM.zvec.json` à l'heure locale. Le trait en cours n'en fait pas partie.
- `Ctrl+O` **ajoute** les traits d'un fichier là où ils ont été dessinés, et montre la vue du fichier.
- `K` efface tout, comme dans l'ancienne version.
- `Ctrl+Z` annule la dernière action : un trait, un ajout de fichier (tous ses traits d'un coup) ou un effacement (tout revient). Il ne ramène pas la vue.

L'historique garde l'état d'avant chaque action, ce qui ne copie que des références.

**Vérifié dans le navigateur** (Chromium du panneau Browser) :
- un dessin de 2 traits, dont un tracé en zoomant jusqu'au niveau 19, revient à l'identique après un rechargement (21 sections, 181 points, même centre exact) ;
- les vraies touches `Ctrl+S` (fichier `drawing-2026-10-25-1700.zvec.json`, contenu relu sans erreur), `0`, `K` et `Ctrl+Z` ;
- l'ouverture du fichier enregistré ajoute ses traits et va au niveau 19, et `Ctrl+Z` retire tout l'ajout en laissant la vue ;
- deux fichiers invalides (un `zLevel` de 1,5, un texte qui n'est pas du JSON) sont refusés sans rien changer ;
- un dessin gardé de version 99 est mis de côté, et la page démarre vide ;
- aucune erreur dans la console.

**Contrôle par mutation** : 6 modifications volontaires (un ajout annulé trait par trait, un ajout qui ne change pas la vue, une lecture qui accepte un `zLevel` non entier, une reprise qui remplace les traits tracés pendant le chargement, un effacement à vide qu'on peut annuler, une reprise qui garde l'historique) ; chacune fait échouer au moins un test.

**Essayé à la main par Sébastien** dans Edge et dans Firefox : ça marche.

**Pas vérifié** :
- l'affichage des messages dans le panneau par mes outils, parce que le panneau Browser était caché et ne dessinait pas d'image ;
- la garde « rien avant le chargement » par une mutation : la course est trop courte pour la provoquer.

**Limites** : avec deux onglets ouverts, le dernier qui enregistre l'emporte. Pas de glisser-déposer de fichier, pas de compression.

**Suite** : la sélection, avec deux gestes de l'ancienne version. Avec le zoomScroll, la sélection suit la vue quand on zoome. Avec le craneScroll (`1` + molette), la vue reste fixe et la sélection change d'échelle. Ensuite, `Ctrl+O` sélectionnera ce qu'il ajoute pour qu'on le place.

## La sélection : décisions (2026-10-25)

La sélection doit servir à tout : assembler des fichiers, corriger un dessin, composer en profondeur, préparer mathgame, copier-coller, appliquer des opérations à un ensemble d'objets. La sélection native de fabric, qu'utilisait l'ancienne version, calcule en flottants dans un seul repère : elle ne tient pas à travers les profondeurs. Il faut donc une sélection à nous.

**Ce que faisait l'ancienne version** (deux lectures de `3DRoom+ic.html`) :
- la sélection de fabric : clic, rectangle, Maj+clic, Ctrl+A ; relâcher Espace désélectionnait tout ;
- un cadre avec des poignées ; `Suppr` effaçait ; `Ctrl+C` / `Ctrl+V` copiaient un seul objet, collé à la même place et à la même taille à l'écran ;
- `X` dupliquait ; Maj+G / Maj+B composaient et décomposaient ;
- tous les traits d'un même appui sur `²` devenaient un seul objet composite ;
- la molette n'emportait en profondeur que les objets **tenus** (bouton enfoncé sur eux), à taille constante à l'écran, et Maj le faisait par puissances de 2 (L33791, L33841) ;
- `1` + molette changeait l'échelle de la sélection autour de son centre (probablement cassé dans la dernière version : NaN, L34493) ;
- les boutons de la souris étaient inversés par défaut (L77053) ; il n'y avait aucune annulation.

**Décisions de Sébastien** :
- **Dessin et sélection, comme avant.**
  - Le bouton gauche sélectionne et tient ; `²` tenu (la touche `Backquote`, quelle que soit la disposition du clavier) puis le bouton gauche dessinent.
  - Seul l'ordre `²` d'abord compte, et lâcher `²` pendant un trait ne l'arrête pas.
  - Le bouton droit, celui du milieu, et Espace + gauche déplacent la vue ; Espace + gauche garde la sélection.
- **Un objet = un appui sur `²`**, même si l'on relâche le bouton entre deux traits.
  - `Ctrl+Z` pendant l'appui retire le dernier trait ; après l'appui, tout le groupe.
  - Maj+G groupe la sélection (les groupes s'emboîtent), et Maj+B défait un niveau.
  - Un groupe tracé ne devient pas la sélection.
- **Sélectionner.**
  - Clic ; Maj+clic ajoute ou retire ; `Alt`+clic prend l'objet du dessous (comme Inkscape et CorelDRAW ; Illustrator fait la même chose avec Ctrl+clic).
  - `Échap` ou un clic dans le vide désélectionnent.
  - Le rectangle dépend du sens, comme dans AutoCAD : de gauche à droite, seulement ce qui est entièrement dedans ; de droite à gauche, tout ce qu'il touche. Il prend à toute profondeur.
- **Affichage** : une autre couleur et un cadre pointillé, sans poignées. Précisé le 2026-10-31 :
  - les traits sélectionnés passent en bleu ;
  - un seul cadre pointillé, autour de toute la sélection ; il englobe aussi les objets pris mais invisibles (trop petits, trop loin), et un message bref dit combien ne se voient pas ;
  - au survol d'un objet, le curseur change (pas de surlignage) ;
  - un clic prend un trait jusqu'à 4 px de son bord (l'encre, pas la boîte englobante comme fabric dans l'ancienne version).
- **Grouper** (2026-10-31) : Maj+G place le groupe à la place de l'objet sélectionné le plus haut, comme Inkscape. Après Maj+G ou Maj+B, le résultat est sélectionné (le groupe, ou les objets libérés).
- **Tout sélectionner** (2026-10-31) : `Ctrl+A`, à toute profondeur, dès l'étape 2. `Espace` + `Ctrl+A` (les trois tenues, dans n'importe quel ordre) prend seulement ce qui touche l'écran, comme un rectangle tiré de droite à gauche sur tout l'écran, objets trop petits pour être vus compris. `A` et `E` restent libres : dans l'ancienne version ils zoomaient et dézoomaient (plus vite avec Maj), et ce comportement devrait revenir.
- **Déplacer.**
  - Appuyer sur un objet le prend et le déplace en un geste.
  - Flèches : 1 px, Maj : 10 px.
  - `Échap` pendant un glisser remet tout à sa place et à sa profondeur d'avant.
- **En profondeur.**
  - **zoomScroll** : la molette emporte ce qu'on tient, qui garde sa place et sa taille à l'écran et reste sous le pointeur, même quand la vue se déplace.
  - **craneScroll** : `1` + molette ; la vue reste fixe et la sélection change d'échelle autour de son centre.
  - Avec Maj, ces deux gestes avancent par puissances de 2.
- **Effacer** : `Suppr` et Retour arrière ; `Ctrl+X` coupe.
- **Copier-coller** par le presse-papiers du système, au format du dessin. On colle à la même place et à la même taille à l'écran qu'à la copie, avec un décalage de 20 px si la copie tomberait exactement sur l'original. Ce qui est collé devient la sélection, comme ce qu'ajoute `Ctrl+O`.
- **Interface** : rien que le dessin.
  - Le panneau est caché par défaut et `H` l'affiche.
  - Un message bref s'affiche en bas de l'écran pendant 3 s.
  - Les avertissements de perte possible restent jusqu'à un clic ou `Échap`.

**Livraison en quatre étapes**, chacune essayée à la main et commitée :
1. les groupes, le mode `²`, le format, l'interface ;
2. sélectionner, effacer, grouper ;
3. déplacer, zoomScroll, craneScroll ;
4. copier, couper, coller, et `Ctrl+O` qui sélectionne.

**Non prévu pour l'instant** : poignées, lasso, verrouillage, ordre d'affichage, aimantation à une grille.

**Rotation : très bientôt** (demande de Sébastien, 2026-10-31). Dans l'ancienne version, il l'avait faite tard et elle lui avait coûté beaucoup d'efforts : plus tôt on la gère, mieux c'est. À décider avant de la commencer : tourner les objets, la vue, ou les deux ; et comment la stocker, puisqu'une rotation quelconque ne garde pas les positions dyadiques exactes (cos et sin ne sont pas dyadiques) : une transformation gardée par objet, ou des points recalculés.

## Étape 1 de la sélection : groupes, touche `²`, interface (2026-10-25)

- **Objets** (`packages/engine/src/drawing.ts`) : `Item = Stroke | Group`, avec des groupes emboîtables.
- **Format `eurekanvas/drawing` version 2** ([drawing-format.md](./drawing-format.md)) : `items`, où chaque objet est un document de trait ou `{ "group": [...] }`. La version 1 se lit toujours, chaque trait devenant un objet seul, donc les fichiers et le dessin gardé restent lisibles.
- **L'éditeur** ne dessine que si `²` était tenu à l'appui du bouton.
  - Pendant l'appui sur `²`, chaque trait est une action. À la fin de l'appui (relâchement de `²`, ou fin du trait en cours s'il dure plus longtemps), les traits deviennent un seul objet et leurs actions n'en font plus qu'une.
  - Une autre action au milieu d'un appui (`K`, `Ctrl+O`, reprise du dessin gardé) termine d'abord le groupe en cours.
  - La perte de focus de la page vaut relâchement de `²` et d'Espace.
- **Interface** : le panneau est caché par défaut, `H` l'affiche (choix mémorisé), et les messages s'affichent en bas de l'écran.

**Vérifié dans le navigateur** (Chromium du panneau Browser, événements et touches) :
- sans `²`, rien n'est dessiné ;
- trois traits avec `²` tenu, puis `Ctrl+Z` qui retire le dernier ; au relâchement, un groupe de deux traits ; `Ctrl+Z` le retire d'un coup ;
- la perte de focus termine l'appui ;
- `H` (vraie touche) affiche puis cache le panneau, et le choix est mémorisé ;
- `Ctrl+S` affiche son message, qui disparaît après 3 s ;
- le dessin gardé en version 1 se relit ; le groupe s'enregistre en version 2 et revient après un rechargement ;
- un dessin gardé illisible donne un avertissement encore affiché après 4 s, qu'un clic ferme ;
- aucune erreur dans la console.

**Contrôle par mutation** : 7 modifications volontaires (dessin sans `²`, historique non fondu, groupe non terminé après un trait commencé avant le relâchement, annulation qui oublie le compte des traits, `K` qui ne termine pas le groupe, groupe vide accepté, version 1 refusée) ; chacune fait échouer au moins un test.

**Essayé à la main par Sébastien**, avec la vraie touche `²` : ça marche. Mes outils, eux, ne peuvent pas tenir une touche pendant un glisser : ils envoient des événements clavier synthétiques.

## Étape 2 de la sélection : sélectionner, effacer, grouper (2026-10-31)

- **Moteur** (`packages/engine/src/hit.ts`) :
  - `itemsAt` donne les objets dessinés sous un point de l'écran, du dessus vers le dessous. Seul ce qui est dessiné compte : mêmes règles que `selectDrawableSections`, dont le choix par section est devenu `drawableProjection`. Le test mesure, en unités locales, la distance du pointeur à chaque segment, avec l'épaisseur interpolée entre ses deux bouts, plus la tolérance (4 px).
  - `itemsInRectangle` travaille sur un rectangle exact du monde (dyadiques). En mode `inside`, il compare la boîte exacte de l'encre de l'objet. En mode `touching`, la boîte exacte de chaque section tranche les cas simples. Quand le rectangle coupe cette boîte, ses côtés passent en unités locales de la section, bornés près d'elle pour tenir dans un `number`. Chaque segment est alors élargi de sa demi-épaisseur, en carré : jusqu'à 0,4 épaisseur de trop près d'un coin.
  - `itemBounds`, `boundsOf` et `boundsToScreen` donnent des boîtes exactes, mémorisées par section et par objet.
- **Éditeur** :
  - La sélection est un ensemble d'objets du premier niveau, gardés par identité. À chaque changement des objets, `Ctrl+Z` compris, elle ne garde que ceux encore présents.
  - Un appui sur un objet est un clic (l'étape 3 en fera un déplacement). Ailleurs, il devient un rectangle au-delà de 4 px. Le coin de départ est un point exact du monde : on peut zoomer ou déplacer la vue pendant le tracé, et le rectangle prend à toute profondeur.
  - Alt+clic prend l'objet sous le plus profond des objets sélectionnés à cet endroit (sous celui du dessus si aucun ne l'est), puis repart du haut. Maj+Alt+clic ajoute cet objet.
  - Maj+clic dans le vide garde la sélection ; Maj+rectangle ajoute.
  - Effacer, grouper et dégrouper sont chacun une action, et terminent d'abord l'appui sur `²` en cours. Sélectionner ne le termine pas. Maj+G demande au moins deux objets.
  - `Échap` abandonne le rectangle en cours, sinon désélectionne.
- **Rendu** : bleu `#1a66ff` pour la sélection, le cadre et le rectangle tiré de gauche à droite ; vert `#1f9d55`, en pointillé, pour le rectangle tiré de droite à gauche, comme AutoCAD. Le cadre est à 4 px de l'encre, et un côté lointain est dessiné à 10 px hors de l'écran au plus.
- **Page** : curseur en main au survol d'un objet ; `Alt` n'ouvre plus la barre de menus ; un message (« 3 objects selected (1 not visible) ») après un rectangle, `Ctrl+A` ou `Espace` + `Ctrl+A`.

**Vérifié dans le navigateur** (Chromium du panneau Browser, événements synthétiques ; le panneau était caché, donc le rendu a été forcé à la main) :
- un clic à 2 px d'un trait de groupe prend le groupe ; Maj+clic ajoute ; un clic dans le vide désélectionne ;
- rectangles dans les deux sens (bleu plein, vert pointillé) ; `Échap` pendant un rectangle ;
- `Ctrl+A`, et `Espace` + `Ctrl+A` dans les deux ordres, après un déplacement de la vue (« 3 objects selected (2 not visible) ») ;
- Maj+G, Maj+B, `Ctrl+Z`, `Suppr`, Retour arrière ; Alt+clic sur deux objets superposés ; `Alt` empêché à l'appui et au relâchement ;
- après un rechargement, les groupes sont relus ; aucune erreur dans la console.

**Contrôle par mutation** : 26 modifications volontaires. Au premier passage, 7 survivaient :
- deux montraient un cas absent des tests : la partie fine d'un trait au bord d'une boîte élargie par sa partie épaisse ;
- une venait de trois objets superposés identiques, que `toEqual` ne distinguait pas ;
- deux montraient que rien ne vérifiait `Ctrl+Z` après un effacement ou un groupement pendant un appui sur `²` ;
- une était mal écrite, et a été refaite ;
- la dernière (`Ctrl+A` qui terminait l'appui) a fait changer le code : sélectionner ne termine plus l'appui.

Toutes sont tuées ensuite.

## Critères de réussite du tronçon

- `packages/engine` : tests Vitest qui passent. En particulier :
  - aller-retour écran ↔ monde à de grandes profondeurs (par exemple ±1000 niveaux de zoom) sans dérive ;
  - un trait tracé en changeant de zoom garde la même forme quand on le regarde à l'échelle de départ ;
  - les sections successives partagent exactement leur point de jonction ;
  - un point tracé à un niveau profond ne se « téléporte » pas quand on dézoome.
- `apps/zveceditor` : une page dans le navigateur où l'on trace en zoomant (molette pendant que le bouton est enfoncé), sans artefact visible, jusqu'à au moins 200 niveaux de profondeur. **Fait pour 130 niveaux** (voir les résultats) ; 200 niveaux n'ont pas été essayés.
- Un document de mesure simple : nombre de points et de sections par trait, et temps d'une image, pour savoir si les décisions 2 et 3 tiennent. **Fait** pour les points, les sections et le temps de traitement des événements ; le temps d'une image dans un navigateur n'a pas été mesuré.

## Hors périmètre de ce tronçon

Objets et slots, maths, défis, sauvegarde, sélection, pixels parfaits (zpixeleditor), serveur et déploiement.
