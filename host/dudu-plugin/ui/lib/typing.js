/** Whether a key press comes from a box the person is typing in (so a shortcut must leave it alone). */
export const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
