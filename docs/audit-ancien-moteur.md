# Audit de l'ancien moteur

Audit statique (lecture seule) de `C:\DEV\infiniteCanvas-main\3DRoom+ic.html`, la version la plus récente de l'ancien moteur (23 mai 2025, en avance sur le repo GitHub [a-user-interface](https://github.com/teachingbeforedying/a-user-interface)).

Les numéros de ligne (`L…`) renvoient à ce fichier. Réalisé le 2026-10-18.

**Non vérifié** : l'appli n'a pas été lancée (comportement et performances réels), le format `.shu` n'a pas été inspecté en détail, le contenu des bibliothèques de `lib/` non plus.

## Décision

- **Approche** : noyau neuf + portage par morceaux. L'ancien code reste la référence, et continue de faire tourner mathgame.fr en attendant.
- **Premier tronçon** : le zoom pendant le tracé (cœur de zveceditor, base de zpixeleditor).
- **Langage et outillage** : TypeScript, Vite, Vitest, workspaces npm.

## Le fichier en chiffres

- Un seul HTML : 127 836 lignes, 4,4 Mo.
- ~69 700 lignes de code réel ; 34 500 lignes blanches ; 21 300 lignes de commentaires `//` (17 %) ; 90 `TODO`/`FIXME`/`HACK`/`XXX`.
- 220 définitions de classes, dont 3 en double : `CompositeSegmentEngine` (L15781, L16158), `CountDownEngine` (L26437, L70416), `CountDownConfig` (L26608, L70238). Plusieurs classes sont définies *à l'intérieur de méthodes* (par exemple `CompositeSegmentEngine`, `InteractorEngine`).
- 72 scripts externes actifs (d'autres sont commentés). Parmi eux : fabric.js 5.3.0 et 20 fichiers `lib/fabric*.js` d'extension ou de patch, mathjs 9.0.0, decimal.js 10.2.1.
- `lib/` embarque du lourd : `maps.fat` 29 Mo, `python` 16 Mo, `mathquill` 5,8 Mo, `maps` 2,9 Mo, `pdf` 1,7 Mo.

### Où sont les lignes de code (hors blancs et commentaires `//`)

| Part | Zone | Contenu |
| ---- | ---- | ------- |
| 42 % | L78251–126912 | Jeux et contenu : `GolfGameStep__Endless_Practice` (27 000 lignes à lui seul, L86871), `GolfCourseConfig`, `Atelier__X_X`, Xylophone, ZPuzzle, GET100, Oya, Hex |
| 19 % | L10210–33543 | `InfiniteCanvas` : une classe d'environ 520 méthodes, dont 194 fabriques `createIc*` (15 `createIcGM*` pour le jeu) |
| 10 % | L37368–51697 | Modèle d'objets et moteurs : `IcObject`, `Represented`, moteurs de slots, `PortalEngine`, `CameraEngine`, `CompositeEngine`, `SnapSlotEngine`… |
| 6 % | L4133–10120 | Extensions de mathjs, `Operator`, `Simplifier`, `Rewriter`, `Inverser`, `Parser`, `MathUtils`… |
| 6 % | L51698–60816 | `FabricIntegration` |
| 5 % | L60817–67432 | Dessin : `DrawingBout`, `DrawingSession`, `DrawingMode*` |
| 5 % | L70984–78250 | Entrées : fichiers, presse-papiers, clavier, souris, tactile, `State` |
| 3 % | L149–4132 | Utilitaires : `Utils`, `ICUtils`, `ImageUtils`, `Logger`… |
| 2 % | L67433–70158 | `Geometry`, `zPixelUtils`, `Snap`, `Touch` |

## Ce qui vaut la peine d'être gardé (les idées, pas le code)

1. **Zoom précis.** La caméra a un zoom en grand nombre (`CameraEngine.getZoom__bigNumber`), et les positions de « pixels » sont des `zPixelCoords {ix, iy, zLevel}` avec des niveaux en puissances de 2 (`zPixelUtils`, L68489 ; `ICUtils`, L839). C'est ce qui rend le zoom réellement infini malgré les flottants du canvas.
2. **Zones de rendu** (`renderZones`). Seuls les objets proches du niveau de zoom courant sont matérialisés en objets de rendu (`redrawCanvas`, L32112 ; `lib/fabric+renderZones.js`).
3. **Séparation modèle / vue.** `IcObject` (modèle précis) et objets fabric (rendu) sont distincts, reliés par `FabricIntegration` (L51698) et `Represented` (L40522).
4. **Zoom pendant le tracé.** Un trait (`DrawingSession`, L61116) est découpé en « bouts » (`DrawingBout`, L60817) à chaque changement d'échelle (`manageFreeDrawingXScroll`, L34025 : on sort du mode dessin, on met à jour, on y rentre). C'est exactement le comportement de zveceditor.
5. **Domaine maths, portable.** `Simplifier` (L6589), `Rewriter` (L7497), `Inverser` (L6431), `Parser` (L8233), `Splitter`, `Joiner`, `MathUtils` (L8780) ; environ 60 générateurs de défis (numération, calcul, négatifs, fractions, puissances/racines/notation scientifique), aiguillés par `?challenge=math/...` (L83067).
6. **Vocabulaire de manipulation.** Les moteurs de slots (toucher, déposer, piquer, accrocher, appliquer, plonger, portails, aimantation). C'est le gameplay pédagogique de mathgame.

## Ce qui bloque

- **Aucun test, aucun module.** Tout est en globales : 539 appels à `fabricIntegration.` hors commentaires, 103 à `globalsSingleton.`, sans les passer en paramètre.
- **Le moteur connaît le jeu.** `createIcGM*` et `Golf*` vivent dans la classe du moteur. Le « moteur » et « l'appli maths » ne sont pas séparés dans le code, alors que la structure d'eurekanvas suppose qu'ils le soient.
- **Fabric 5 étendu et patché dans 20 fichiers** (surcharge de `findTarget`, pinceaux, objets zPixel…) : fragile et figé sur une ancienne version.
- **Deux bibliothèques de grands nombres** (`Decimal` et `math.bignumber`), utilisées selon l'endroit.
- **`eval(text)`** sur le contenu d'un objet texte (L31034) : acceptable pour un usage solo, risqué si des sauvegardes `.shu` circulent entre utilisateurs (élèves).
- **Dépendances anciennes** : mathjs 9.0.0, fabric 5.3.0, decimal.js 10.2.1.

## Pourquoi pas les autres approches

- **Reprise progressive** : il n'y a pas de coutures. Pas de tests, tout passe par des globales, et la classe centrale mélange moteur et jeu. Chaque extraction serait un risque sans filet.
- **Réécriture totale d'un coup** : 42 % du code est du contenu qu'on peut porter plus tard, au besoin. Le vrai noyau à réécrire est petit (zoom, coordonnées, zones de rendu, dessin).

## Repères pour le portage

| Sujet | Où regarder |
| ----- | ----------- |
| Coordonnées zPixel, niveaux de zoom | `zPixelUtils` L68489, `ICUtils` L839, `Geometry` L67433 |
| Caméra | `CameraEngine` L45383, `InfiniteCanvas.scale` |
| Zones de rendu | `InfiniteCanvas.assignRenderZones__*`, `redrawCanvas` L32112, `lib/fabric+renderZones.js` |
| Dessin et zoom pendant le tracé | `DrawingBout` L60817, `DrawingSession` L61116, `manageFreeDrawingXScroll` L34025, `lib/fabric+zIndexPencilBrush.js`, `lib/fabric+zPixelBrush.js`, `lib/fabricjs+zCurve3.js` |
| Maths | `Simplifier` L6589, `Rewriter` L7497, `Inverser` L6431, `Parser` L8233, `MathUtils` L8780, extensions mathjs L4133–4459 |
| Défis | `GolfCourseConfig` L79923, aiguillage L83067, `GolfGameStep__Endless_Practice` L86871 |
| Manipulation (slots) | `TouchSlotEngine` L41280, `DropTouchSlotEngine` L42027, `PokeSlotEngine` L42533, `HookSlotEngine` L43165, `ApplySlotEngine` L43792, `DiveSlotEngine` L44319, `SnapSlotEngine` L46316 |
| Idées en attente | `still_shute.txt`, `programmashute.txt`, `_book/still_book.md` dans `a-user-interface` |
