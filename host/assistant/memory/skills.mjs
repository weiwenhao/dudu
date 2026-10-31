// 嘟嘟's own skills: skills/<name>/SKILL.md (docs/assistant.md 3.5). Ways of working it learned (when to use, how, which operation
// of which connector), written as plain text. They are for 嘟嘟 only: the skills of Claude Code, ChatGPT and the other agents live
// on their side and are never read or changed here.
//
//   const skills = createSkills({ files, now = Date.now });
//   skills.list() -> [{ name, description, since, src }]      skills.read(name) -> { ..., text } | null
//   skills.remove(name) -> boolean                           skills.citing(turnIds) -> [name]
//   skills.check({ name, description, text }) -> the clean fields, or throws SkillInvalid
//   skills.create({ name, description, text, src }) -> { name, raw }   (check, then writes; throws SkillInvalid)
//
// Only the tidy creates skills (createMemory hands the outside world list/read/remove), always with the turns they came from.
// The file starts with a small header (name, description, since, src between --- lines); text only: no code blocks or scripts.
import { dayOf, FileError, parseRefs } from './files.mjs';
import { findSecret } from './secrets.mjs';

export const SKILL_NAME = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
const TEXT_MAX = 4000;
const DESCRIPTION_MAX = 160;

export class SkillInvalid extends Error {}

const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

function parseSkill(name, raw) {
  const text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const head = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(text);
  const meta = {};
  if (head) {
    for (const line of head[1].split('\n')) {
      const pair = /^([A-Za-z_-]+):[ \t]*(.*)$/.exec(line);
      if (pair) meta[pair[1]] = pair[2].trim();
    }
  }
  const body = (head ? head[2] : text).trim();
  const firstLine = body.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? body.split('\n')[0] ?? '';
  return {
    name, description: oneLine(meta.description || firstLine.replace(/^#+\s*/, '')).slice(0, DESCRIPTION_MAX),
    since: meta.since ?? '', src: parseRefs(meta.src), text: body,
  };
}

export function createSkills({ files, now = Date.now }) {
  const path = (name) => `skills/${name}/SKILL.md`;
  function read(name) {
    if (typeof name !== 'string' || !SKILL_NAME.test(name)) return null;
    const found = files.read(path(name));
    return found ? parseSkill(name, found.text) : null;
  }
  function check({ name, description, text }) {
    if (typeof name !== 'string' || !SKILL_NAME.test(name.trim())) throw new SkillInvalid('A skill name is letters, numbers, - and _, at most 64 characters.');
    const line = oneLine(description);
    const body = String(text ?? '').replace(/\r\n?/g, '\n').trim();
    if (!line || line.length > DESCRIPTION_MAX) throw new SkillInvalid(`A skill needs a one-line description of at most ${DESCRIPTION_MAX} characters.`);
    if (!body || body.length > TEXT_MAX) throw new SkillInvalid(`A skill is plain text of at most ${TEXT_MAX} characters.`);
    if (/^\s*(?:```|~~~)/m.test(body) || /^#!/m.test(body)) throw new SkillInvalid('A skill is text only: no code blocks or scripts.');
    if (findSecret(body) || findSecret(line)) throw new SkillInvalid('A skill cannot contain a password, key or card number.');
    return { name: name.trim(), description: line, text: body };
  }
  const readable = (name) => {
    try {
      return read(name);
    } catch (error) {
      if (error instanceof FileError) return null; // one unreadable file does not take the others with it
      throw error;
    }
  };
  const list = () => files.list('skills').map(readable).filter(Boolean).map(({ text, ...rest }) => rest);
  return {
    list,
    read,
    remove(name) {
      if (typeof name !== 'string' || !SKILL_NAME.test(name)) return false;
      return files.remove(path(name));
    },
    /** Names of skills whose source cites any of these turns (turn:<id>). */
    citing(turnIds) {
      const wanted = new Set([...turnIds].map((id) => `turn:${id}`));
      return list().filter((skill) => skill.src.some((ref) => wanted.has(ref))).map((skill) => skill.name);
    },
    /** The clean { name, description, text } of a proposed skill, or SkillInvalid. */
    check,
    create({ name, description, text, src }) {
      const skill = check({ name, description, text });
      if (!Array.isArray(src) || !src.length) throw new SkillInvalid('A skill needs the turns it came from.');
      if (files.read(path(skill.name))) throw new SkillInvalid(`There is already a skill called ${skill.name}.`);
      const raw = `---\nname: ${skill.name}\ndescription: ${skill.description}\nsince: ${dayOf(now())}\nsrc: ${src.join(',')}\n---\n\n${skill.text}\n`;
      files.write(path(skill.name), raw);
      return { name: skill.name, raw };
    },
  };
}
