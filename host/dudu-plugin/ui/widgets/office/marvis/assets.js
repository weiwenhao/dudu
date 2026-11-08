// What the scene draws with: marvis-office's furniture atlas and monitor animations (SOURCE.md), the pictures drawn for the rest area and the sleeping room, and the 16 people
// of the owner's sheet, whole. The esbuild of the client turns each image into a data URL (scripts/build-client.mjs), so the plugin stays one file.
import workstationImage from './assets/workstation@2x.webp';
import workstationSheet from './assets/workstation@2x.webp.json';
import ticketImage from './assets/screens/fc_ticket.webp';
import ticketSheet from './assets/screens/fc_ticket.webp.json';
import pingpongModule from './assets/modules/pingpong.webp';
import ps5Module from './assets/modules/ps5.webp';
import ps5Sofa from './assets/modules/ps5-sofa.webp';
import balconyModule from './assets/modules/balcony.webp';
import doorImage from './assets/modules/door.webp';
import sleepModule from './assets/modules/sleep.webp';
import sleepFrontImage from './assets/modules/sleep-front.webp';
import peopleMeta from './assets/people/people.json';
import mainScreenImage from './assets/screens/fc_screen_working_main.webp';
import mainScreenSheet from './assets/screens/fc_screen_working_main.webp.json';
import apkScreenImage from './assets/screens/fc_screen_working_apk_use.webp';
import apkScreenSheet from './assets/screens/fc_screen_working_apk_use.webp.json';
import fileScreenImage from './assets/screens/fc_screen_working_file_use.webp';
import fileScreenSheet from './assets/screens/fc_screen_working_file_use.webp.json';
import browserScreenImage from './assets/screens/fc_screen_working_search_or_browser_use.webp';
import browserScreenSheet from './assets/screens/fc_screen_working_search_or_browser_use.webp.json';
import playingScreenImage from './assets/screens/fc_screen_playing1.webp';
import playingScreenSheet from './assets/screens/fc_screen_playing1.webp.json';
import person00 from './assets/people/person-00.webp';
import person01 from './assets/people/person-01.webp';
import person02 from './assets/people/person-02.webp';
import person03 from './assets/people/person-03.webp';
import person04 from './assets/people/person-04.webp';
import person05 from './assets/people/person-05.webp';
import person06 from './assets/people/person-06.webp';
import person07 from './assets/people/person-07.webp';
import person08 from './assets/people/person-08.webp';
import person09 from './assets/people/person-09.webp';
import person10 from './assets/people/person-10.webp';
import person11 from './assets/people/person-11.webp';
import person12 from './assets/people/person-12.webp';
import person13 from './assets/people/person-13.webp';
import person14 from './assets/people/person-14.webp';
import person15 from './assets/people/person-15.webp';

/**
 * What was drawn for this widget in the atlas's manner (marvis/SOURCE.md): the added column's modules, the sofa's back and arms, the balcony,
 * the door, and the sleeping room (its floor and beds, and, apart, the blankets, which are drawn over whoever sleeps).
 */
export const MODULE_IMAGES = { pingpong: pingpongModule, ps5: ps5Module, ps5Sofa, balcony: balconyModule, door: doorImage, sleep: sleepModule, sleepFront: sleepFrontImage };

export const ATLAS = { image: workstationImage, sheet: workstationSheet };
export const TICKET = { image: ticketImage, sheet: ticketSheet };

/** The monitors' animations: what is on a screen while somebody works (main is the boss's), and a game for somebody who is not. */
export const SCREENS = {
  main: { image: mainScreenImage, sheet: mainScreenSheet },
  apk: { image: apkScreenImage, sheet: apkScreenSheet },
  file: { image: fileScreenImage, sheet: fileScreenSheet },
  browser: { image: browserScreenImage, sheet: browserScreenSheet },
  playing: { image: playingScreenImage, sheet: playingScreenSheet },
};

/**
 * The 16 people, in the order of the owner's sheet (left to right, top to bottom): a sheet of frames each, and what is where in them
 * (`PEOPLE.cell`, the `poses` with their frames, rows and anchors, `tops`: how tall each pose is, per person). Built by .local/office3d/people3d.
 */
export const PEOPLE_IMAGES = [person00, person01, person02, person03, person04, person05, person06, person07, person08, person09, person10, person11, person12, person13, person14, person15];
export const PEOPLE = peopleMeta;
