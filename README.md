# eurekanvas

An infinite canvas engine, and the apps built on top of it.

Space is not constrained in width, height, or depth: you can zoom in forever,
and keep zooming while you draw.

The original goal: let students **manipulate math objects** in small,
puzzle-like levels (think Sokoban), where they can make lots of mistakes,
figure things out by themselves, and get their own little *eureka* moments.

## Structure

| Folder                 | What it is                                                                 | Site                                       |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/engine/`     | The infinite canvas engine                                                 |                                            |
| `apps/mathgame/`       | Math activities built by manipulating objects                              | [mathgame.fr](https://mathgame.fr)         |
| `apps/zpixeleditor/`   | A good old paint program, with perfect pixels at any zoom level            | [zpixeleditor.com](http://zpixeleditor.com) |
| `apps/zveceditor/`     | A "2.5D" vector editor: change the zoom level while drawing a freehand curve |                                            |
| `docs/ideas/`          | Ideas worth coding, sorted                                                 |                                            |

## Status

Fresh start (October 2026). Nothing runs from this repository yet.

Previous iterations, kept as references:

- [a-user-interface](https://github.com/teachingbeforedying/a-user-interface): the engine and the math challenges
- [zpsite](https://github.com/teachingbeforedying/zpsite): the server behind zpixeleditor.com
- [iC\_\_recherche](https://github.com/teachingbeforedying/iC__recherche): research around the infinite canvas

## License

[MIT](./LICENSE)
