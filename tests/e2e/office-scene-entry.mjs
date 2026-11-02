// The real Pixi scene and its real textures, with a test-controlled clock and issue list.
import { Application, Container } from 'pixi.js';
import { fitScene, SCENE } from '../../host/dudu-plugin/ui/widgets/office/layout.js';
import { createOffice } from '../../host/dudu-plugin/ui/widgets/office/marvis/office.js';
import { createLibrary } from '../../host/dudu-plugin/ui/widgets/office/marvis/textures.js';

const app = new Application();
await app.init({ width: 1400, height: 700, backgroundAlpha: 0, autoStart: false, preference: 'webgl' });
document.body.append(app.canvas);
const viewport = new Container();
const fit = fitScene(SCENE, 1400, 700);
viewport.scale.set(fit.scale);
viewport.position.set(fit.x, fit.y);
app.stage.addChild(viewport);
const library = createLibrary();
const [atlas, modules, people] = await Promise.all([library.atlas(), library.modules(), library.people()]);
let office;

function snapshot() {
  const ball = office.layers.effects.getChildByLabel('pingpong-ball');
  const shadow = office.layers.effects.getChildByLabel('pingpong-shadow');
  return {
    people: [...office.people.values()].filter((person) => !person.gone).map((person) => ({
      id: person.id, state: person.state, place: person.place, pose: person.pose, walking: Boolean(person.route || person.hop),
      frame: person.view.sprite.texture.frame.x, until: person.until, epoch: person.epoch,
      at: { ...person.at },
    })),
    ball: { visible: ball.visible, x: ball.x, y: ball.y },
    shadow: { visible: shadow.visible, x: shadow.x, y: shadow.y },
  };
}

window.officeTest = {
  reset(issues, still = false) {
    office?.dispose();
    office = createOffice({ atlas, modules, people, still, screen: library.screen, ticket: library.ticket });
    viewport.addChild(office.root);
    office.setIssues(issues, false);
    return this.step(0);
  },
  setIssues(issues, animate = true) {
    office.setIssues(issues, animate);
    return this.step(0);
  },
  setStill(still) {
    office.setStill(still);
    return this.step(0);
  },
  step(seconds) {
    let remaining = seconds;
    do {
      const dt = Math.min(1 / 30, remaining);
      office.update(dt, { deltaTime: dt * 60 });
      remaining -= dt;
    } while (remaining > 1e-9);
    app.render();
    return snapshot();
  },
  snapshot,
};
