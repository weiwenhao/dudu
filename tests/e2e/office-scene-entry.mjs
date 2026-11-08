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
      id: person.id, look: person.look, seat: person.seat, state: person.state, zone: person.zone, place: person.place, pose: person.pose, walking: Boolean(person.route || person.hop),
      route: Boolean(person.route), hop: Boolean(person.hop), sleeping: person.view.zs.visible, frame: person.view.sprite.texture.frame.x, until: person.until, epoch: person.epoch,
      at: { ...person.at },
    })),
    ball: { visible: ball.visible, x: ball.x, y: ball.y },
    shadow: { visible: shadow.visible, x: shadow.x, y: shadow.y },
    // what plays on each desk's monitor: the name of the animation's first frame, or null
    screens: office.seats.map((seat) => seat.players.screen.container.children[0]?.textures?.[0]?.label ?? null),
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
    library.release?.(app.renderer); // as the widget's scene does: the decoded copy of each picture the card has is let go of, so these tests draw what it draws
    return snapshot();
  },
  snapshot,
  /** Waits until the people's sheets are decoded (they are, when a person of that look first appears), and draws the office with them. */
  async loaded() {
    await library.settled?.();
    app.render();
    library.release?.(app.renderer);
    return snapshot();
  },
  /** The colour of the canvas at a point (in canvas pixels), as [r, g, b, a]: the scene is drawn first, in the same task, or the buffer is gone. */
  pixel(x, y) {
    app.render();
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const context = probe.getContext('2d');
    context.drawImage(app.canvas, x, y, 1, 1, 0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data];
  },
  /** Where a point of the plane is on the canvas. */
  toCanvas(point) {
    return { x: fit.x + point.x * fit.scale, y: fit.y + point.y * fit.scale };
  },
};
