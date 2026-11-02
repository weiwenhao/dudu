# Where this folder comes from

The scene in this folder is **winterBI/marvis-office** (https://github.com/winterBI/marvis-office, commit `6b6aba4`, "Marvis Office 2D Demo"):
a Vue 3 + PixiJS 2D office whose look follows the AI Agent office on https://marvis.qq.com/. It is used here because the owner asked for the
Office widget to be that scene, as it is.

What is taken from it, unchanged unless said:

| In the repo | Here |
|---|---|
| `src/assets/img/workstation@2x.webp` and `.json` (desks, chairs, monitors, shadows, the water bar, the treadmill, the toilet) | `assets/workstation@2x.webp`, `.json` |
| `src/assets/agent/fc_screen_*.webp` and `.json` (the animated monitors: four of the working ones and the game), `fc_ticket` | `assets/screens/` (the 1x sheets; the repo loads the 2x ones) |
| `src/hooks/useScene.ts`, `useWorkstation.ts`, `useSprite.ts`, `useActionTextures.ts`: layers, sprite positions and scales, the desk group, the screen and effect sprites, the viewport fit | `furniture.js`, `textures.js` and `../scene.js`, as JavaScript without Vue |
| `src/hooks/usePerson.ts`, `useAnimation.ts`: how a person moves (straight lines, 0.22 px/ms, ease in and out, 800 ms at least) and how the office is told what to do | `person.js`, `office.js` |
| `src/assets/agent/roles.ts`: where the six desks are | `../layout.js` (`deskAt`; a third column at the same spacing makes the nine desks the widget has) |

What is **not** taken: the black mascots (their sprite sheets are 25 MB), the name labels, the info panel with the Marvis agents' text, the loading page,
the debug panel.

What is **not from the repo** at all, and is ours:

- The people (`assets/people/`): the 16 clay figures of the owner's own avatar sheet, made whole (the sheet has only their busts) as small 3D models
  that follow each figure's hair, skin, clothes, beard and glasses, and drawn offline into one sheet of poses per person (walking, sitting at a desk
  seen from behind, drinking, smoking, playing, ...). The sheet's busts themselves are not used.
- The column of new facilities (`assets/modules/`: ping-pong, a PS5 corner, a balcony) and the door in the original column's west wall, drawn
  offline in the same view and style as the original furniture and placed on floors copied from the original modules. (The toilet of the atlas
  is used as it is, but moved to the foot of the new column, and the balcony is in its place.)

## Rights

The repo has no licence file. Its README says it is not an official Marvis or Tencent project and that the scene, characters and art are inspired by (and
partly are) Marvis'; it asks not to use it commercially or in a way that could be mistaken for the official product, and suggests replacing the characters,
scene and art with your own before publishing. This folder is therefore kept apart, so that it can be removed or replaced in one step: delete `marvis/`
and put another scene behind `office.js`.
