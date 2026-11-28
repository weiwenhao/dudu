// The settings 嘟嘟 keeps for itself (docs/assistant.md 2 and 5): one small JSON file in the state folder
// (<DSH_HOME>/dudu/assistant/settings.json), written by the program, never by hand.
//
//   projectFolder   where the owner's Markdown files live; null means the default folder
//   pet             what the pet may do: { enabled, doubleSpace, voice }
//   deepSleep       whether an idle agent, or one whose run finished, that nobody has handled for half an hour is put into deep sleep (sessions/deep-sleep.mjs); on unless turned off; the same switch
//                   lets go of the harness process of a conversation that is no issue's after the same waits (home/deep-sleep.mjs)
//   views           the display options and filters of each tab of the Issues widget, as the page keeps them
//
// Only a missing file uses defaults. An unreadable or invalid existing file fails without moving or rewriting it.
// Unknown keys are kept when saving, so a newer version's settings survive an older one running.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_NEEDS_YOU_COLOR, isNeedsYouColor } from './needs-you-color.mjs';

export const DEFAULTS = Object.freeze({
  projectFolder: null,
  pet: Object.freeze({ enabled: true, doubleSpace: true, voice: true }),
  // Full access: the owner usually gives agents full permission (2026-11-05) and said the default must not be read only (2026-11-09: "默认就给完全权限"). It is the permission
  // of 嘟嘟's conversation and, unless the owner chose another, of the collections (a read-only sandbox cannot renew lark-cli's login, and the run waited ten minutes for an approval nobody gave).
  conversation: Object.freeze({ model: null, permission: 'danger-full-access' }),
  deepSleep: true,
  widgets: Object.freeze({ developer: false }),
  needsYouColor: DEFAULT_NEEDS_YOU_COLOR,
  views: Object.freeze({}),
});

const MAX_VIEWS_BYTES = 64 * 1024;
const VERSION = 2; // 1 (no marker): the file held the program's own default permission as if it were a choice; 2: it holds what the owner chose
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const wrong = (message, next = 'Send the value in the shape settings returns it.') => ({ outcome: 'needs_clarification', message, next });

/** Checks a patch of settings; returns the clean patch or a refusal. */
function parsePatch(patch) {
  if (!isObject(patch)) return wrong('A settings patch must be an object.');
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'projectFolder') {
      if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > 4096)) return wrong('projectFolder must be a path, or null for the default folder.');
      clean.projectFolder = value === null ? null : value.trim();
    } else if (key === 'pet') {
      if (!isObject(patch.pet) || Object.keys(patch.pet).some((name) => !(name in DEFAULTS.pet) || typeof patch.pet[name] !== 'boolean')) return wrong('pet is { enabled, doubleSpace, voice }, each true or false.');
      clean.pet = { ...patch.pet };
    } else if (key === 'deepSleep') {
      if (typeof value !== 'boolean') return wrong('deepSleep must be true or false.');
      clean.deepSleep = value;
    } else if (key === 'conversation') {
      if (!isObject(value) || Object.keys(value).some((name) => !['model', 'permission'].includes(name))) return wrong('conversation accepts model and permission.');
      const selected = value.model;
      if (selected !== undefined && selected !== null && (!isObject(selected)
        || Object.keys(selected).some((name) => !['provider', 'model', 'reasoningEffort'].includes(name))
        || ['provider', 'model'].some((name) => typeof selected[name] !== 'string' || !selected[name].trim() || selected[name].length > 256)
        || selected.reasoningEffort !== undefined && (typeof selected.reasoningEffort !== 'string' || !selected.reasoningEffort || selected.reasoningEffort.length > 64))) return wrong('conversation.model is a provider, model and optional reasoningEffort, or null.');
      if (value.permission !== undefined && (typeof value.permission !== 'string' || !value.permission || value.permission.length > 128)) return wrong('conversation.permission must name a permission preset.');
      clean.conversation = structuredClone(value);
    } else if (key === 'views') {
      if (!isObject(value) || Object.values(value).some((view) => !isObject(view))) return wrong('views is an object of one object per tab.');
      if (JSON.stringify(value).length > MAX_VIEWS_BYTES) return wrong('views is too large to keep.');
      clean.views = value;
    } else if (key === 'needsYouColor') {
      if (!isNeedsYouColor(value)) return wrong('needsYouColor must be one of the preset colors.');
      clean.needsYouColor = value.toLowerCase();
    } else if (key === 'widgets') {
      if (!isObject(value) || Object.keys(value).some((name) => name !== 'developer') || typeof value.developer !== 'boolean') return wrong('widgets is { developer: true or false }.');
      clean.widgets = { developer: value.developer };
    } else {
      return wrong(`Unknown setting "${key}". Known: ${Object.keys(DEFAULTS).join(', ')}.`);
    }
  }
  return { clean };
}

/** The settings as callers get them: a copy, without the version marker the file keeps. */
const visible = ({ settingsVersion: _marker, ...rest }) => structuredClone(rest);

export function createSettings({ file }) {
  let value = null;

  function read() {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { ...structuredClone(DEFAULTS), settingsVersion: VERSION };
    }
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) throw new TypeError('not an object');
    // A failed check must not replace a saved model or permission with defaults.
    const known = parsePatch(Object.fromEntries(Object.entries(parsed).filter(([key]) => key in DEFAULTS)));
    if (!known.clean) throw new TypeError(known.message);
    const merged = {
      ...structuredClone(DEFAULTS), ...parsed, ...known.clean,
      conversation: { ...DEFAULTS.conversation, ...known.clean.conversation },
      settingsVersion: VERSION,
    };
    // Until version 2 every change in the conversation settings wrote the default permission (then read only) into the file with it, so a read only in a file without the marker
    // was never a choice: it counts as the default.
    if (!(parsed.settingsVersion >= VERSION) && merged.conversation.permission === 'read-only') merged.conversation.permission = DEFAULTS.conversation.permission;
    return merged;
  }

  const current = () => (value ??= read());

  function write(next) {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  }

  return {
    get: () => ({ outcome: 'success', settings: visible(current()) }),
    /** One setting as it is now, without copying them all (the issues ask whether deep sleep is on for every row they build). */
    value: (key) => current()[key],
    /** Applies a patch: pet and conversation merge their fields; other keys are replaced. */
    set(patch) {
      const parsed = parsePatch(patch);
      if (!parsed.clean) return parsed;
      const next = {
        ...current(), ...parsed.clean,
        ...(parsed.clean.pet ? { pet: { ...current().pet, ...parsed.clean.pet } } : {}),
        ...(parsed.clean.conversation ? { conversation: { ...current().conversation, ...parsed.clean.conversation } } : {}),
      };
      try { write(next); } catch (error) { return { outcome: 'error', message: `The settings could not be saved: ${error.message}`, next: 'Check that the state folder can be written, then call again.' }; }
      value = next;
      return { outcome: 'success', settings: visible(next) };
    },
  };
}
