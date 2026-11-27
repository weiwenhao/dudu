/** Every collection session has an id that starts like this (lists of sessions leave `dudu-assistant-` ones out). */
export const INTAKE_PREFIX = 'dudu-assistant-intake-';

/** A collector's own conversation: it is on no board and no list, so what happens in it is told to no phone. */
export const isIntakeSession = (id) => typeof id === 'string' && id.startsWith(INTAKE_PREFIX);
