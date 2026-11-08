// A focus ring is for the person who moves with the Tab key. After a click, Esc or Enter it is only in the way: when a menu or a window closes, the page hands the focus
// back to the button that opened it, and the browser calls that :focus-visible whenever a key was the last thing pressed, so a blue frame was drawn round the button
// (owner, 2026-11-08, on the sessions icon: "很多地方都有"; before that round the pet and round whole rows).
//
// So the root element is marked `data-dudu-tabbing` from a Tab (without Ctrl, Cmd or Alt) until the next pointer press or Escape, and the CSS draws a ring only then
// (styles.css, the `focus-visible` variant; text fields keep theirs always). One listener pair serves every scope that is mounted.
const ATTRIBUTE = 'data-dudu-tabbing';
let users = 0;
let remove = null;

function listen(doc) {
  const root = doc.documentElement;
  const onKey = (event) => {
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) root.setAttribute(ATTRIBUTE, '');
    else if (event.key === 'Escape') root.removeAttribute(ATTRIBUTE);
  };
  const onPointer = () => root.removeAttribute(ATTRIBUTE);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onPointer, true);
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onPointer, true);
    root.removeAttribute(ATTRIBUTE);
  };
}

/** Start following the keys; returns what stops it. The listeners are taken off when the last user is gone. */
export function trackTabbing(doc = document) {
  if (users++ === 0) remove = listen(doc);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users === 0) { remove?.(); remove = null; }
  };
}
