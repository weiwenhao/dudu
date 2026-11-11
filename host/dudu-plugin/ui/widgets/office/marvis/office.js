// The office: marvis-office's scene (useScene.ts: the layers, the furniture, the desks) with the people of the issues in it. Where the
// original plays one scripted story (useAnimation.ts), each person here does what their issue's agent is doing, drawn from the side we
// see them from (the back at a desk, the side walking). Where somebody is depends on their zone (`zoneOf` in layout.js):
//   working    at the desk, typing, the monitor playing its animation
//   resting    in the activity area, whether the work waits for review, input or approval (blocked) or the agent is idle: the water bar, a
//              treadmill, the toilet, ping-pong, the PS5 sofa or the balcony. They go to whichever of those is free (a random one, the same
//              for the same issue), stay 40 to 90 seconds and go to another.
//   sleeping   in the sleeping room, only when the agent is in deep sleep: they walk there through the door, lie down in a bed and stay there
//              (a bed is theirs while they sleep: they do not get up to change it) until the agent is woken.
//   outside    nobody is moved to make room (owner, 2026-11-07: when the sleeping room or any other part has no room left, they "走到屏幕外面就行了"): whoever has no place
//              walks out of the picture, by the corner of the plane (`EXIT`), and walks in again when a place is free.
// People move the way useAnimation.ts moves them: at 0.22 units a millisecond, eased at both ends, 0.8 seconds at least, but not in one
// straight line: over the open floor, round the furniture (routes.js), out of a chair or a seat and into the next one.
import { AnimatedSprite, Container, Graphics } from 'pixi.js';
import { avatarOf, ballPath, chairBottom, deskAt, DESKS, EXIT, headPoint, HIPS_ABOVE_FEET, hipsOf, lookFor, OUTSIDE, paddles, PING_PONG, pickSpot, placeOf, plan, seatAnchor, spotAt, stateOf, stayFor, TV_SCREEN, zoneOf } from '../layout.js';
import { measure, routeFor } from '../routes.js';
import { createDesk, createDeskPlayers, createModules, createScenery, createSleepRoom } from './furniture.js';
import { createPerson } from './person.js';

// Whoever is awake and not working is in the activity area, and moves about it; whoever's agent is in deep sleep is in a bed (the sleeping room), the one that is theirs.
const isResting = (person) => person?.zone === 'resting';
const bedOf = (person) => `bed-${person.seat}`;
const inBed = (person) => spotAt(person.place)?.kind === 'bed';

const WALK_SPEED = 0.22; // scene units per millisecond (defaultWalkSpeed)
const MIN_MOVE = 0.8; // seconds (defaultMinMoveDuration)
const HOP = 0.3; // seconds, to sit down on or get up from the toilet or the sofa, or to step onto the treadmill
const HOP_BED = 0.5; // to lie down in a bed, or get up from it
const FLIGHT = 1.1; // seconds, for the ping-pong ball to go from one player to the other
const FADE = 0.45; // seconds, for somebody who appears or goes
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2);

const SCREEN_KINDS = ['browser', 'apk', 'file']; // what the monitors of the desks show while somebody works, in turn
const screenFor = (seat) => SCREEN_KINDS[seat % SCREEN_KINDS.length];

/**
 * What is drawn and what it does. `atlas` is the furniture's textures by name, `people` the 16 people's frames, `screen(name)` and
 * `ticket()` give the animations' frames.
 */
export function createOffice({ atlas, modules, people: looks, screen, still = false }) {
  const root = new Container();
  // `scenery` and `desks` never change (scene.js draws them once into one picture and lets go of their pictures); `screens` is what plays on the
  // monitors; `people` holds the desks' chairs too, ordered with them by how far down the plane they are; `chairs` is what is drawn over whoever sits
  // or lies in it (the PS5 sofa's back and arms, the beds' blankets); `walls` is the sleeping room's partition wall, over all of it.
  const layers = Object.fromEntries(['scenery', 'desks', 'screens', 'people', 'chairs', 'walls', 'effects'].map((name) => [name, new Container()]));
  root.addChild(layers.scenery, layers.desks, layers.screens, layers.people, layers.chairs, layers.walls, layers.effects);
  const sleepRoom = createSleepRoom(modules);
  layers.scenery.addChild(sleepRoom.room);
  layers.scenery.addChild(createScenery(atlas));
  const column = createModules(modules, atlas);
  layers.scenery.addChild(column.layer);
  layers.chairs.addChild(column.sofa, sleepRoom.blankets);
  layers.walls.addChild(sleepRoom.walls);
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
    layers.desks.addChild(desk.base);
    layers.screens.addChild(players.screen.container);
    desk.chair.zIndex = chairBottom(seat); // over whoever sits in it, under whoever walks past in front of it
    layers.people.addChild(desk.chair);
    layers.effects.addChild(players.effect.container);
    seats.push({ players, token: 0 });
  }

  layers.people.sortableChildren = true; // whoever is nearer (lower on the plane) is drawn over whoever is behind

  const people = new Map();
  const outside = new Set(); // the issues whose people walked out for want of a place: they walk in again (and are not new) when one is free
  let seating = [];
  let clock = 0;
  let hover = null;
  let motionStill = still;
  let instant = false; // while the first list is read: nobody walks, everyone is just there

  // --- what plays at a desk
  // Two people of different states can have the same number (a person past the eighth takes a free desk or bed, whose number somebody who rests elsewhere also
  // has): clearing a desk for one must not stop the screen of the other who works at it.
  const deskInUse = (seat, except) => [...people.values()].some((other) => other !== except && !other.gone && other.place === 'desk' && other.seat === seat);
  const clearDesk = (seat, except = null) => {
    if (!seats[seat] || deskInUse(seat, except)) return;
    seats[seat].token += 1;
    seats[seat].players.screen.clear();
    seats[seat].players.effect.clear();
  };
  const applyDesk = (person) => {
    const seat = seats[person.seat];
    if (!seat) return;
    clearDesk(person.seat, person);
    const token = seat.token;
    if (person.route || person.hop || person.place !== 'desk') return;
    const show = (kind) => screen(kind).then((frames) => { if (seat.token === token && !person.gone) seat.players.screen.play(frames); }).catch(() => {});
    // A number is a desk's only for whoever works there: somebody in the activity area has a number of their own, which may be the number of a desk where another works
    // (it must not play a game on that monitor). One who is awake at a desk because no place is free plays on it if it is nobody else's.
    if (person.zone === 'working') show(screenFor(person.seat));
    else if (isResting(person) && person.games && !deskInUse(person.seat, person)) show('playing');
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
    person.hop = { ...hop, start: clock, duration: spotAt(hop.key)?.kind === 'bed' ? HOP_BED : HOP };
    placeAt(person, hop.from);
  };

  /** The way over the open floor to the place they are headed for, from where they are (through `via`, a gate they are leaving by). */
  const startRoute = (person, via = null) => {
    const target = person.exiting ? { gate: EXIT, stand: OUTSIDE } : placeOf(person.place, person.seat); // out: to the corner of the plane, and on beyond its edge
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
    clearDesk(here.seat, person);
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
    if (person.exiting) { retire(person); return; }
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
    const resting = [...people.values()].filter((other) => !other.gone && isResting(other));
    const previous = spotAt(person.place);
    const previousPartner = previous?.kind === 'pingpong' ? resting.find((other) => other.place === previous.partner) : null;
    person.until = clock + stayFor(person.id, person.epoch);
    const key = pickSpot(takenSpots(), person.id, person.epoch, person.place === 'desk' || inBed(person) ? [] : [person.place], {
      idleCount: allowPair && previous?.kind !== 'pingpong' ? resting.length : 1,
    });
    const spot = spotAt(key);
    let destination = key;
    if (spot?.kind === 'pingpong') {
      const partner = resting.find((other) => other !== person && other.place === spot.partner) ??
        resting.find((other) => other !== person && spotAt(other.place)?.kind !== 'pingpong');
      if (partner) {
        goToSpot(partner, spot.partner);
        partner.until = person.until;
        partner.epoch += 1;
      } else destination = pickSpot(takenSpots(), person.id, person.epoch, [person.place]);
    }
    if (destination) goToSpot(person, destination); // (no place free: they stay where they are; the activity area counts only as many people as have a place)
    person.epoch += 1;
    if (previousPartner) chooseNext(previousPartner, false);
  };

  const reconcilePingPong = () => {
    const players = [...people.values()].filter((person) => !person.gone && spotAt(person.place)?.kind === 'pingpong');
    if (players.length === 2 && players.every(isResting) && players[0].place !== players[1].place) return;
    for (const person of players) if (isResting(person)) chooseNext(person, false);
  };

  /** Tells a person which part of the office they belong in now: the desk, the activity area or a bed (`person.state` stays the agent's, for the name tag). */
  const setZone = (person, zone) => {
    if (person.zone === zone) return;
    person.zone = zone;
    if (zone === 'sleeping') {
      goTo(person, bedOf(person));
    } else if (zone === 'working') {
      if (person.place !== 'desk' || person.route || person.hop) goToDesk(person);
      else applyDesk(person);
    } else if (!person.hop && (person.route || person.place === 'desk' || inBed(person))) {
      // off to the activity area: from the desk or the bed, or from where they are on their way to one of them
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

  /** Walks somebody to their place from outside the picture (or from where they are, when they were on their way out): a place is free for them now. */
  const walkIn = (person, zone, fromHere = false) => {
    person.zone = zone;
    person.place = zone === 'sleeping' ? bedOf(person) : zone === 'working' ? 'desk' : pickSpot(takenSpots(), person.id, person.epoch, [], { idleCount: 1 }) ?? 'desk';
    person.epoch += 1;
    person.until = clock + stayFor(person.id, person.epoch);
    person.rested = null;
    if (person.hop) return; // they finish sitting down or getting up, and `finishHop` takes them on from there
    person.seatedNow = false;
    if (!fromHere) { person.view.container.alpha = 1; placeAt(person, OUTSIDE); }
    startRoute(person);
  };

  const addPerson = (id, seat, issue, animate) => {
    const leaving = people.get(`out:${id}`); // on its way out, and a place is free again: the same person turns round
    if (leaving) {
      people.delete(`out:${id}`);
      outside.delete(id);
      leaving.exiting = false;
      leaving.seat = seat;
      leaving.issue = issue;
      leaving.state = stateOf(issue);
      people.set(id, leaving);
      walkIn(leaving, zoneOf(issue), true);
      return leaving;
    }
    const look = lookFor(id, [...people.values()].map((other) => other.look)); // nobody who is drawn shares a look while there are looks left
    const view = createPerson(look, looks[look]);
    const person = {
      id, look, seat, issue, view, state: stateOf(issue), zone: null, place: 'desk', route: null, hop: null, rested: { key: 'desk', seat }, seatedNow: true, fade: null,
      at: seatAnchor(seat), epoch: 0, until: 0, phase: Math.random() * Math.PI * 2, games: avatarOf(id) % 2 === 1, gone: false, pose: 'sit_type', facing: 1,
    };
    people.set(id, person);
    layers.people.addChild(view.container);
    placeAt(person, person.at);
    const returning = outside.delete(id);
    if (returning && animate && !motionStill) { walkIn(person, zoneOf(issue)); return person; }
    if (animate && !motionStill) { view.container.alpha = 0; fade(person, 1); }
    setZone(person, zoneOf(issue));
    return person;
  };

  /** Somebody who has no place walks out of the picture (see `EXIT`), over the open floor and on beyond its edge; `retire` lets go of them there. */
  const sendOut = (person) => {
    outside.add(person.id);
    people.delete(person.id);
    people.set(`out:${person.id}`, person);
    clearDesk(person.seat, person);
    person.exiting = true;
    person.zone = 'out';
    person.place = 'out';
    person.until = Infinity;
    if (person.hop) return; // they finish sitting down or getting up, and `finishHop` / `rest` take them on from there
    if (person.route) { startRoute(person); return; }
    if (person.rested) leave(person); else startRoute(person);
  };

  /** The end of the way out: they are outside the picture, and let go of (faded out, where the picture shows more than the plane). */
  const retire = (person) => {
    person.route = null;
    person.gone = true;
    people.delete(`out:${person.id}`);
    const destroy = () => { person.view.container.destroy({ children: true }); };
    if (motionStill) { destroy(); return; }
    person.view.ring.visible = false;
    people.set(`gone:${person.id}`, person);
    fade(person, 0, () => { people.delete(`gone:${person.id}`); destroy(); });
  };

  const removePerson = (person, animate, { walkOut = false } = {}) => {
    if (walkOut && animate && !motionStill) { sendOut(person); return; }
    person.gone = true;
    person.route = null;
    person.hop = null;
    clearDesk(person.seat, person);
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
    for (const { id, reason } of next.leave) { const person = people.get(id); if (person) removePerson(person, animate, { walkOut: reason === 'overflow' }); }
    for (const { id, seat } of next.enter) addPerson(id, seat, byId.get(id), animate);
    for (const { id, to } of next.move) {
      const person = people.get(id);
      if (!person) continue;
      clearDesk(person.seat, person);
      person.seat = to;
      // A number only changes with the zone (places are kept while the zone stays): `setZone` below sends the person to the place of the new one. Nobody who sleeps is
      // sent to another bed because of a number; one who works at a desk and still does goes to the desk of the number.
      if (person.zone === 'working' && zoneOf(byId.get(id)) === 'working' && person.place === 'desk') goToDesk(person);
    }
    for (const { id } of next.seats) {
      const person = people.get(id);
      if (!person) continue;
      person.issue = byId.get(id);
      person.state = stateOf(person.issue);
      setZone(person, zoneOf(person.issue));
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
      if (kind === 'bed') return { pose: 'lie_sleep', frame: 0, sleeping: true };
      if (kind === 'toilet') return { pose: 'sit_side', frame: 0 };
      if (kind === 'ps5') return { pose: 'sit_type', frame: 0 };
      return { pose: 'walk', frame: tick(16, 6), flip: true }; // onto the treadmill: it faces left
    }
    if (person.route) return { pose: 'walk', frame: tick(16, 6), flip: person.facing < 0 };
    const spot = person.place === 'desk' ? null : spotAt(person.place);
    if (spot) {
      const flip = spot.face < 0;
      switch (spot.kind) {
        case 'bed': return { pose: 'lie_sleep', frame: 0, sleeping: true };
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
    if (isResting(person) && person.games) return { pose: 'sit_type', frame: tick(5, 2) }; // awake, at a game
    switch (person.zone) {
      case 'working': return { pose: 'sit_type', frame: tick(4, 2) };
      case 'resting': return { pose: 'sit_type', frame: 0 }; // at the desk because the activity area has no place free: awake, and still
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
    if (pose.sleeping) view.zs.children.forEach((letter, i) => { const k = ((clock * 0.33 + i / 3) % 1); letter.x = 14 + k * 12 + i * 3; letter.y = -view.topOf(person.pose) - 2 - k * 20; letter.alpha = Math.sin(k * Math.PI); letter.scale.set(0.7 + k * 0.5); });
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
      } else if (!motionStill && isResting(person) && clock >= person.until) {
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
    ball.visible = Boolean(isResting(a) && isResting(b));
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
    return [...people.values()].filter((person) => !person.gone && !person.exiting).map((person) => {
      const point = headPoint(person.at, person.view.topOf(person.pose));
      return { id: person.id, state: person.state, x: point.x, y: point.y };
    });
  }

  /** The person who is at this point of the plane, the nearest the front first. */
  function pick(x, y) {
    let found = null;
    for (const person of people.values()) {
      if (person.gone || person.exiting) continue;
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
      for (const person of [...people.values()]) {
        if (person.gone) continue;
        if (person.exiting) { people.delete(`out:${person.id}`); person.gone = true; person.view.container.destroy({ children: true }); continue; } // no walking in a still picture: they are out
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
