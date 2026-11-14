// The visible text of one DSH assistant attempt. Reasoning and tool arguments
// never become a group-chat reply. Durable assistant messages remain authoritative.
export function createReplyStream({ maxChars = 6000, maxBlocks = 128 } = {}) {
  let active = null;
  let visible = '';
  const changed = (text) => {
    if (text === visible) return null;
    visible = text;
    return text;
  };
  return {
    accept(frame) {
      if (frame?.type === 'start' && typeof frame.attemptId === 'string') {
        active = { id: frame.attemptId, next: 0, revision: frame.revision, blocks: new Map() };
        return null;
      }
      if (!active || frame?.attemptId !== active.id) return null;
      if (frame.type === 'end') {
        active = null;
        return frame.outcome?.kind === 'abandoned' ? changed('') : null;
      }
      if (frame.type !== 'chunk' || !Number.isSafeInteger(frame.index)
        || frame.index < active.next || frame.revision < active.revision) return null;
      if (frame.index !== active.next) {
        active = null;
        return changed('');
      }
      active.next++;
      active.revision = frame.revision;
      const chunk = frame.chunk;
      if (!chunk || !Number.isSafeInteger(chunk.index) || chunk.index < 0) return null;
      const index = chunk.index;
      const type = chunk.type;
      const isStart = type === 'block-start' && chunk.blockType === 'text';
      const isText = type === 'text-delta' || type === 'text-chunks';
      const isEnd = type === 'block-end' && chunk.block?.type === 'text';
      if (!isStart && !isText && !isEnd) return null;
      if (!active.blocks.has(index) && active.blocks.size >= maxBlocks) return null;
      const previous = active.blocks.get(index) ?? '';
      if (!active.blocks.has(index)) active.blocks.set(index, '');
      const room = Math.max(0, maxChars - [...active.blocks.values()].reduce((sum, text) => sum + text.length, 0) + previous.length - (active.blocks.size - 1));
      const addition = isText ? (Array.isArray(chunk.texts) ? chunk.texts : [chunk.text])
        .filter((text) => typeof text === 'string').join('').slice(0, room) : '';
      const text = isStart ? '' : isEnd ? String(chunk.block.text ?? '').slice(0, room) : (previous + addition).slice(0, room);
      active.blocks.set(index, text);
      return changed([...active.blocks].sort(([a], [b]) => a - b).map(([, value]) => value).join('\n').slice(0, maxChars));
    },
  };
}
