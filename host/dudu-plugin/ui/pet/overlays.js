// Host controls portal their menus and confirmations to body. React still delivers their events through this pet's boundary.
const owned = new WeakSet();
let latest = null;
export const beginPetInteraction = (event) => {
  latest = event;
  if (event.target instanceof Element && event.target.closest('[data-pet-menu]')) owned.add(event);
};
export const ownPetInteraction = (event) => {
  latest = event.nativeEvent;
  owned.add(latest);
};
export const isPetInteraction = (event) => owned.has(event);
export function petOwnsOverlay(element) {
  if (latest && owned.has(latest)) element.setAttribute('data-pet-menu', '');
  return element.hasAttribute('data-pet-menu');
}
