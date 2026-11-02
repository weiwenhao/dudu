// The office: marvis-office's scene (useScene.ts: the layers, the furniture, the desks) with the people of the issues in it. Where the
// original plays one scripted story (useAnimation.ts), each person here does what their issue's agent is doing, drawn from the side we
// see them from (the back at a desk, the side walking):
//   working    at the desk, typing, the monitor playing its animation
//   needs you  at the desk, waving an arm, a ticket above the desk (the ticket marvis-office's boss gets when a task comes in)
//   stuck      at the desk, head down, arms hanging, the monitor dark
//   idle       asleep at the desk with Zs, the monitor dark or playing a game; or off to the rest area: the water bar, the treadmill, the
//              toilet, ping-pong, the PS5 sofa or the balcony. They go to whichever of those is free (a random one, the same for the same
//              issue), stay 40 to 90 seconds and go to another or back.
// People move the way useAnimation.ts moves them: at 0.22 units a millisecond, eased at both ends, 0.8 seconds at least, but not in one
// straight line: over the open floor, round the furniture (routes.js), out of a chair or a seat and into the next one.
import { AnimatedSprite, Container, Graphics } from 'pixi.js';
import { avatarOf, ballPath, deskAt, DESKS, headPoint, HIPS_ABOVE_FEET, hipsOf, paddles, PING_PONG, pickSpot, placeOf, plan, seatAnchor, spotAt, stateOf, stayFor, TV_SCREEN } from '../layout.js';
import { measure, routeFor } from '../routes.js';
import { createDesk, createDeskPlayers, createModules, createScenery } from './furniture.js';
import { createPerson } from './person.js';

const WALK_SPEED = 0.22; // scene units per millisecond (defaultWalkSpeed)
const MIN_MOVE = 0.8; // seconds (defaultMinMoveDuration)
const HOP = 0.3; // seconds, to sit down on or get up from the toilet or the sofa, or to step onto the treadmill
const FLIGHT = 1.1; // seconds, for the ping-pong ball to go from one player to the other
const FADE = 0.45; // seconds, for somebody who appears or goes
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2);

const SCREEN_KINDS = ['browser', 'apk', 'file']; // what the monitors of the desks after the boss's show while somebody works, in turn
const screenFor = (seat) => (seat === 0 ? 'main' : SCREEN_KINDS[(seat - 1) % SCREEN_KINDS.length]);

/**
 * What is drawn and what it does. `atlas` is the furniture's textures by name, `people` the 16 people's frames, `screen(name)` and
 * `ticket()` give the animations' frames.
 */
export function createOffice({ atlas, modules, people: looks, screen, ticket, still = false }) {
  const root = new Container();
  const layers = Object.fromEntries(['scenery', 'desks', 'people', 'chairs', 'effects'].map((name) => [name, new Container()]));
  root.addChild(layers.scenery, layers.desks, layers.people, layers.chairs, layers.effects);
  layers.scenery.addChild(createScenery(atlas));
  const column = createModules(modules, atlas);
  layers.scenery.addChild(column.layer);
  layers.chairs.addChild(column.sofa);
  const ball = new Graphics().circle(0, 0, 2.6).fill({ color: 0xf08a3c });
  const ballShadow = new Graphics().ellipse(0, 0, 3.4, 1.5).fill({ color: 0x000000, alpha: 0.2 }); // on the table, under the ball
  ball.label = 'pingpong-ball';
  ballShadow.label = 'pingpong-shadow';
  ball.visible = false;
  ballShadow.visible = false;
  layers.effects.addChild(ballShadow, ball);
  let tv = null; // the animation on the PS5 corner's TV, while somebody plays
  let tvLoading = false;

  const seats = [];
  for (let seat = 0; seat < DESKS; seat++) {
    const desk = createDesk(atlas, deskAt(seat));
    const players = createDeskPlayers(deskAt(seat));
    layers.desks.addChild(desk.base, players.screen.container);
    layers.chairs.addChild(desk.chair);
    layers.effects.addChild(players.effect.container);
    seats.push({ players, token: 0 });
  }

  layers.people.sortableChildren = true; // whoever is nearer (lower on the plane) is drawn over whoever is behind

  const people = new Map();
  let seating = [];
  let clock = 0;
  let hover = null;
  let motionStill = still;
  let instant = false; // while the first list is read: nobody walks, everyone is just there

  // --- what plays at a desk
  const clearDesk = (seat) => {
    if (!seats[seat]) return;
    seats[seat].token += 1;
    seats[seat].players.screen.clear();
    seats[seat].players.effect.clear();
  };
  const applyDesk = (person) => {
    const seat = seats[person.seat];
    if (!seat) return;
    clearDesk(person.seat);
    const token = seat.token;
    if (person.route || person.hop || person.place !== 'desk') return;
    const show = (kind) => screen(kind).then((frames) => { if (seat.token === token && !person.gone) seat.players.screen.play(frames); }).catch(() => {});
    if (person.state === 'working') show(screenFor(person.seat));
    else if (person.state === 'needs_you') ticket().then((frames) => { if (seat.token === token && !person.gone) seat.players.effect.play(frames); }).catch(() => {});
    else if (person.state === 'idle' && person.games) show('playing');
  };

  // --- moving
  // A person is at rest somewhere (`rested`: a desk's seat or a spot), or on a route over the open floor (`route`), or between a seat and
  // the floor (`hop`: sitting down on the toilet or the sofa, getting up from them, stepping onto the treadmill). `place` is where they are
  // headed or at: 'desk' or a spot's key.
  const placeAt = (person, to) => {
    person.at = { x: to.x, y: to.y };
    person.view.container.x = to.x;
    person.view.container.y = to.y;
    person.view.container.zIndex = to.y;
  };

  const takenSpots = () => new Set([...people.values()].filter((person) => !person.gone && person.place !== 'desk').map((person) => person.place));

  /** They are there: placed at their resting place, in the pose of somebody who rests there. */
  const rest = (person, key) => {
    const here = placeOf(key, person.seat);
    person.route = null;
    person.hop = null;
    person.rested = { key, seat: person.seat };
    person.seatedNow = here.seated;
    placeAt(person, here.rest);
    if (person.place === key) applyDesk(person);
    else leave(person);
  };

  const beginHop = (person, hop) => {
    person.hop = { ...hop, start: clock, duration: HOP };
    placeAt(person, hop.from);
  };

  /** The way over the open floor to the place they are headed for, from where they are (through `via`, a gate they are leaving by). */
  const startRoute = (person, via = null) => {
    const target = placeOf(person.place, person.seat);
    const middle = routeFor(via ?? person.at, target.gate);
    const all = [{ ...person.at }, ...(via ? [via] : []), ...middle.slice(1), ...(target.stand.x !== target.gate.x || target.stand.y !== target.gate.y ? [target.stand] : [])];
    const points = all.filter((point, i) => i === 0 || Math.hypot(point.x - all[i - 1].x, point.y - all[i - 1].y) > 0.5);
    if (points.length < 2) points.push({ ...points[0] }); // already there: a walk of no length
    const way = measure(points);
    person.route = { points, way, start: clock, duration: Math.max(MIN_MOVE, way.total / WALK_SPEED / 1000) };
  };

  /** They get up from where they rest and set off for the place they are headed for. */
  function leave(person) {
    const here = person.rested;
    person.rested = null;
    clearDesk(here.seat);
    const from = placeOf(here.key, here.seat);
    if (from.hop) {
      beginHop(person, { from: from.rest, to: from.seated ? hipsOf(from.stand) : from.stand, key: here.key, seated: from.seated, out: true, via: from.gate });
      return;
    }
    person.seatedNow = false;
    placeAt(person, from.stand);
    startRoute(person, from.gate);
  }

  /** Sends a person to a place: now, or, when they are in the middle of sitting down or getting up, as soon as they have. */
  const goTo = (person, key) => {
    person.place = key;
    if (person.hop) return;
    if (person.route) {
      if (motionStill || instant) rest(person, key);
      else startRoute(person);
      return;
    }
    const here = person.rested;
    if (here && here.key === key && here.seat === person.seat) { applyDesk(person); return; }
    if (!here || motionStill || instant) { rest(person, key); return; }
    leave(person);
  };
  const goToDesk = (person) => goTo(person, 'desk');
  const goToSpot = (person, key) => goTo(person, key);

  /** The end of a route: sit down, or step up, if the place wants that; else they are there. */
  const finishRoute = (person) => {
    const target = placeOf(person.place, person.seat);
    person.route = null;
    if (!target.hop) { rest(person, person.place); return; }
    person.seatedNow = target.seated;
    beginHop(person, { from: target.seated ? hipsOf(target.stand) : target.stand, to: target.rest, key: person.place, seated: target.seated, out: false });
  };

  const finishHop = (person) => {
    const { out, via, key, to } = person.hop;
    person.hop = null;
    if (out) {
      person.seatedNow = false;
      placeAt(person, to);
      startRoute(person, via);
    } else {
      rest(person, key);
    }
  };

  /** Reserve both ends together. A pair leaves together when its shared rest time ends. */
  const chooseNext = (person, allowPair = true) => {
    const idle = [...people.values()].filter((other) => !other.gone && other.state === 'idle');
    const previous = spotAt(person.place);
    const previousPartner = previous?.kind === 'pingpong' ? idle.find((other) => other.place === previous.partner) : null;
    person.until = clock + stayFor(person.id, person.epoch);
    const key = pickSpot(takenSpots(), person.id, person.epoch, person.place === 'desk' ? [] : [person.place], {
      idleCount: allowPair && previous?.kind !== 'pingpong' ? idle.length : 1,
    });
    const spot = spotAt(key);
    let destination = key;
    if (spot?.kind === 'pingpong') {
      const partner = idle.find((other) => other !== person && other.place === spot.partner) ??
        idle.find((other) => other !== person && spotAt(other.place)?.kind !== 'pingpong');
      if (partner) {
        goToSpot(partner, spot.partner);
        partner.until = person.until;
        partner.epoch += 1;
      } else destination = pickSpot(takenSpots(), person.id, person.epoch, [person.place]);
    }
    if (destination) goToSpot(person, destination);
    else if (person.place !== 'desk') goToDesk(person);
    person.epoch += 1;
    if (previousPartner) chooseNext(previousPartner, false);
  };

  const reconcilePingPong = () => {
    const players = [...people.values()].filter((person) => !person.gone && spotAt(person.place)?.kind === 'pingpong');
    if (players.length === 2 && players.every((person) => person.state === 'idle') && players[0].place !== players[1].place) return;
    for (const person of players) if (person.state === 'idle') chooseNext(person, false);
  };

  const setState = (person, state) => {
    if (person.state === state) return;
    person.state = state;
    if (state !== 'idle') {
      if (person.place !== 'desk' || person.route || person.hop) goToDesk(person);
      else applyDesk(person);
    } else if (person.place === 'desk' && !person.route && !person.hop) {
      applyDesk(person);
      chooseNext(person);
    }
  };

  // --- people come and go
  const fade = (person, to, done) => {
    if (motionStill) {
      person.view.container.alpha = to;
      done?.();
      return;
    }
    person.fade = { from: person.view.container.alpha, to, start: clock, done };
  };

  const addPerson = (id, seat, issue, animate) => {
    const look = avatarOf(id);
    const view = createPerson(look, looks[look]);
    const person = {
      id, seat, issue, view, state: null, place: 'desk', route: null, hop: null, rested: { key: 'desk', seat }, seatedNow: true, fade: null,
      at: seatAnchor(seat), epoch: 0, until: 0, phase: Math.random() * Math.PI * 2, games: avatarOf(id) % 2 === 1, gone: false, pose: 'sit_type', facing: 1,
    };
    people.set(id, person);
    layers.people.addChild(view.container);
    placeAt(person, person.at);
    if (animate && !motionStill) { view.container.alpha = 0; fade(person, 1); }
    setState(person, stateOf(issue));
    return person;
  };

  const removePerson = (person, animate) => {
    person.gone = true;
    person.route = null;
    person.hop = null;
    clearDesk(person.seat);
    people.delete(person.id);
    const destroy = () => { person.view.container.destroy({ children: true }); };
    if (animate && !motionStill) {
      person.view.ring.visible = false;
      people.set(`gone:${person.id}`, person); // still drawn while it fades; update() lets go of it
      fade(person, 0, () => { people.delete(`gone:${person.id}`); destroy(); });
    } else {
      destroy();
    }
  };

  /** Tell the office who is there now (the issues the API sent, in order). `animate` is false for the first list: everyone is just there. */
  function setIssues(issues, animate) {
    instant = !animate;
    const next = plan(seating, issues);
    const byId = new Map((issues ?? []).filter(Boolean).map((issue) => [issue.id, issue]));
    for (const { id } of next.leave) { const person = people.get(id); if (person) removePerson(person, animate); }
    for (const { id, seat } of next.enter) addPerson(id, seat, byId.get(id), animate);
    for (const { id, to } of next.move) {
      const person = people.get(id);
      if (!person) continue;
      clearDesk(person.seat);
      person.seat = to;
      if (person.place === 'desk') goToDesk(person); // somebody away keeps to their spot: they go to the new desk when they are called back
    }
    for (const { id } of next.seats) {
      const person = people.get(id);
      if (!person) continue;
      person.issue = byId.get(id);
      setState(person, stateOf(person.issue));
    }
    seating = next.seats;
    reconcilePingPong();
    instant = false;
    for (const person of people.values()) if (!person.gone) showPose(person);
    return next;
  }

  // --- the clock
  /** The person resting at a spot (not walking to it or sitting down), if anybody is. */
  const restingAt = (key) => [...people.values()].find((person) => !person.gone && !person.route && !person.hop && person.rested?.key === key);

  // What a person is doing, as which of the sheet's poses to show (the sheet has them from the side we see them from: the back at a desk, the
  // side walking), which of its frames, and whether it is mirrored (the poses seen from the side face right).
  const poseOf = (person, t) => {
    const p = person.phase;
    const still = motionStill;
    const tick = (rate, frames, offset = 0) => (still ? 0 : Math.floor(t * rate + p * 3 + offset) % frames);
    if (person.hop) {
      const kind = spotAt(person.hop.key)?.kind;
      if (kind === 'toilet') return { pose: 'sit_side', frame: 0 };
      if (kind === 'ps5') return { pose: 'sit_type', frame: 0 };
      return { pose: 'walk', frame: tick(16, 6), flip: true }; // onto the treadmill: it faces left
    }
    if (person.route) return { pose: 'walk', frame: tick(16, 6), flip: person.facing < 0 };
    const spot = person.place === 'desk' ? null : spotAt(person.place);
    if (spot) {
      const flip = spot.face < 0;
      switch (spot.kind) {
        case 'coffee': return { pose: 'sip_side', frame: still || (t + p) % 6 >= 1 ? 1 : 0, flip }; // a sip every six seconds
        case 'treadmill': return { pose: 'walk', frame: tick(20, 6), flip: true };
        case 'toilet': return { pose: 'sit_side', frame: 0 };
        case 'pingpong': {
          const mine = spot.key === 'pingpong-a' ? 0 : FLIGHT; // when this player hits the ball: the start of the flight away from them
          const since = (t - mine + 2 * FLIGHT * 4) % (2 * FLIGHT);
          return { pose: spot.key === 'pingpong-a' ? 'play_side_a' : 'play_side_b', frame: !still && restingAt(spot.partner) && since < 0.28 ? 1 : 0, flip }; // nobody to hit to: no swing
        }
        case 'ps5': return !still && (t + p) % 7 < 0.9 ? { pose: 'sit_wave', frame: tick(4, 2) } : { pose: 'sit_type', frame: tick(5, 2) }; // now and then a cheer
        default: return { pose: 'smoke_side', frame: still || (t + p) % 8 >= 1.2 ? 1 : 0, flip }; // a drag every eight seconds
      }
    }
    if (person.state === 'idle' && person.games) return { pose: 'sit_type', frame: tick(5, 2) }; // awake, at a game
    switch (person.state) {
      case 'working': return { pose: 'sit_type', frame: tick(4, 2) };
      case 'needs_you': return { pose: 'sit_wave', frame: tick(3, 2) };
      case 'stuck': return { pose: 'sit_slump', frame: 0 };
      default: return { pose: 'sit_sleep', frame: 0, sleeping: true };
    }
  };

  /** Puts a person in the pose, frame and mirroring they have now. */
  const showPose = (person) => {
    const pose = poseOf(person, clock);
    const { view } = person;
    person.pose = pose.pose;
    view.show(pose.pose, pose.frame, pose.flip);
    view.body.scale.y = pose.sleeping && !motionStill ? 1 + Math.sin(clock * 1.4 + person.phase) * 0.012 : 1; // breathing, from the hips
    view.shadow.visible = !view.seated(pose.pose);
    view.ring.visible = hover === person.id;
    view.ring.y = view.seated(pose.pose) ? HIPS_ABOVE_FEET : 0;
    view.zs.visible = Boolean(pose.sleeping);
    if (pose.sleeping) view.zs.children.forEach((letter, i) => { const k = ((clock * 0.33 + i / 3) % 1); letter.x = 14 + k * 12 + i * 3; letter.y = -view.topOf('sit_sleep') - 2 - k * 20; letter.alpha = Math.sin(k * Math.PI); letter.scale.set(0.7 + k * 0.5); });
  };

  /** Advance everything by `dt` seconds; `ticker` drives the animated monitors. */
  function update(dt, ticker) {
    clock += motionStill ? 0 : dt;
    for (const person of [...people.values()]) {
      if (person.fade) {
        const progress = Math.min(1, (clock - person.fade.start) / FADE);
        person.view.container.alpha = person.fade.from + (person.fade.to - person.fade.from) * ease(progress);
        if (progress >= 1) { const { done } = person.fade; person.fade = null; done?.(); }
      }
      if (person.gone) continue;
      if (person.hop) {
        const { from, to, start, duration } = person.hop;
        const progress = Math.min(1, (clock - start) / duration);
        const k = ease(progress);
        placeAt(person, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
        if (progress >= 1) finishHop(person);
      } else if (person.route) {
        const { way, start, duration } = person.route;
        const progress = Math.min(1, (clock - start) / duration);
        const here = way.at(ease(progress) * way.total);
        if (here.dx) person.facing = here.dx;
        placeAt(person, here);
        if (progress >= 1) finishRoute(person);
      } else if (!motionStill && person.state === 'idle' && clock >= person.until && person.until > 0) {
        chooseNext(person);
      }
      showPose(person);
    }
    for (const seat of seats) { seat.players.screen.tick(ticker); seat.players.effect.tick(ticker); }
    // somebody on the PS5 sofa: the TV plays a game; two at the ping-pong table: the ball goes between them
    const playing = Boolean(restingAt('ps5-a') || restingAt('ps5-b'));
    if (playing && !tv && !tvLoading) {
      tvLoading = true;
      screen('playing').then((frames) => {
        tvLoading = false;
        if (tv || root.destroyed) return;
        tv = new AnimatedSprite(frames, false);
        tv.x = TV_SCREEN.x;
        tv.y = TV_SCREEN.y;
        tv.width = TV_SCREEN.width;
        tv.height = TV_SCREEN.height;
        tv.animationSpeed = 0.35;
        tv.play();
        layers.scenery.addChild(tv);
      }).catch(() => { tvLoading = false; });
    } else if (!playing && tv) {
      tv.destroy();
      tv = null;
    }
    tv?.update(ticker);
    const a = restingAt('pingpong-a');
    const b = restingAt('pingpong-b');
    ball.visible = Boolean(a?.state === 'idle' && b?.state === 'idle');
    ballShadow.visible = ball.visible;
    if (ball.visible) {
      const hands = paddles(a.at, b.at);
      const cycle = clock % (2 * FLIGHT);
      const out = cycle < FLIGHT;
      const k = (out ? cycle : cycle - FLIGHT) / FLIGHT;
      const where = out ? ballPath(k, hands.a, hands.b) : ballPath(k, hands.b, hands.a);
      ball.x = where.x;
      ball.y = where.y;
      ballShadow.x = where.x;
      ballShadow.y = PING_PONG.line;
      ballShadow.alpha = Math.max(0.35, 1 - (PING_PONG.line - where.y) / 70); // it fades as the ball goes up
    }
  }

  /** Where each name tag points on the plane: just above the head of whoever is there. */
  function tags() {
    return [...people.values()].filter((person) => !person.gone).map((person) => {
      const point = headPoint(person.at, person.view.topOf(person.pose));
      return { id: person.id, state: person.state, x: point.x, y: point.y };
    });
  }

  /** The person who is at this point of the plane, the nearest the front first. */
  function pick(x, y) {
    let found = null;
    for (const person of people.values()) {
      if (person.gone) continue;
      const { at } = person;
      if (x < at.x - 26 || x > at.x + 26 || y < at.y - person.view.topOf(person.pose) - 4 || y > at.y + (person.view.seated(person.pose) ? HIPS_ABOVE_FEET + 4 : 12)) continue;
      if (!found || at.y > found.at.y) found = person;
    }
    return found?.id ?? null;
  }

  return {
    root,
    layers,
    /** Poses everybody as they are now, without moving the clock (a still scene is drawn without ticking). */
    refresh() { for (const person of people.values()) if (!person.gone) showPose(person); },
    seats,
    setIssues,
    update,
    tags,
    pick,
    setHover(id) { hover = id ?? null; },
    setStill(next) {
      motionStill = next;
      for (const person of people.values()) {
        if (person.gone) continue;
        person.fade = null;
        person.view.container.alpha = 1;
        rest(person, person.place);
        showPose(person);
      }
    },
    /** Whether anything is on the move (a walk, a fade): the tags have to be asked for again. */
    get moving() { return [...people.values()].some((person) => person.route || person.hop || person.fade); },
    get people() { return people; },
    dispose() { root.destroy({ children: true }); people.clear(); },
  };
}
