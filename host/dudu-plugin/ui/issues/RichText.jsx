import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Extension } from '@tiptap/core';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Suggestion } from '@tiptap/suggestion';
import { Bold, Code, Italic, Link2, Strikethrough } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { usePortalContainer } from '../lib/scope.jsx';
import { T } from '../strings.js';

// The description of an issue as a rich document (owner, 2026-11-05, after Linear): headings, bold, italic, strike, code, links, lists, checklists, quotes, code blocks and a
// divider, typed as Markdown shortcuts (`# `, `- `, `1. `, `> `, ``` ` ```), from the "/" menu, or from the bar that comes up over selected text. What is kept is Markdown
// (the `brief` of the issue stays text that an agent reads as it is); text that was never Markdown reads as paragraphs with its line breaks.

/** The blocks of the "/" menu: what each does to the line it is typed on. */
const BLOCKS = [
  ['heading1', (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run()],
  ['heading2', (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run()],
  ['heading3', (editor, range) => editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run()],
  ['bulletList', (editor, range) => editor.chain().focus().deleteRange(range).toggleBulletList().run()],
  ['orderedList', (editor, range) => editor.chain().focus().deleteRange(range).toggleOrderedList().run()],
  ['taskList', (editor, range) => editor.chain().focus().deleteRange(range).toggleTaskList().run()],
  ['quote', (editor, range) => editor.chain().focus().deleteRange(range).toggleBlockquote().run()],
  ['codeBlock', (editor, range) => editor.chain().focus().deleteRange(range).toggleCodeBlock().run()],
  ['divider', (editor, range) => editor.chain().focus().deleteRange(range).setHorizontalRule().run()],
].map(([key, run]) => ({ key, run }));

const matches = (block, query) => {
  const q = query.trim().toLowerCase();
  return !q || block.key.toLowerCase().includes(q) || T.richText.blocks[block.key].toLowerCase().includes(q);
};

const slashExtension = (hooks) => Extension.create({
  name: 'slashMenu',
  addProseMirrorPlugins() {
    return [Suggestion({
      editor: this.editor, char: '/', allowSpaces: false,
      allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name !== 'codeBlock',
      items: ({ query }) => BLOCKS.filter((block) => matches(block, query)),
      command: ({ editor, range, props }) => props.run(editor, range),
      render: () => ({
        onStart: (props) => hooks.show(props), onUpdate: (props) => hooks.show(props),
        onKeyDown: ({ event }) => hooks.key(event), onExit: () => hooks.hide(),
      }),
    })];
  },
});

const webAddress = (value) => {
  const text = value.trim();
  if (!text) return null;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try { const url = new URL(full); return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null; } catch { return null; }
};

/** The bar over selected text: bold, italic, strikethrough, code, and a link (its address is typed in the bar). */
function FormatBar({ editor }) {
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState('');
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({ bold: current.isActive('bold'), italic: current.isActive('italic'), strike: current.isActive('strike'), code: current.isActive('code'), link: current.isActive('link') }) });
  const button = (key, Icon, run, on) => <button key={key} type="button" aria-label={T.richText.format[key]} aria-pressed={on} title={T.richText.format[key]}
    onMouseDown={(event) => event.preventDefault()} onClick={run}
    className={cn('flex size-7 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', on && 'bg-accent text-foreground')}><Icon className="size-4" aria-hidden="true" /></button>;
  const apply = () => {
    const href = webAddress(address);
    if (!href) return;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setLinking(false);
    setAddress('');
  };
  return (
    <div data-rich-format-bar="" className="z-[1000] flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      {linking ? <input autoFocus value={address} onChange={(event) => setAddress(event.target.value)} placeholder={T.richText.linkPlaceholder} aria-label={T.richText.format.link}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); apply(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLinking(false); setAddress(''); editor.commands.focus(); }
        }}
        className="h-7 w-56 rounded-md bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground" />
        : <>
          {button('bold', Bold, () => editor.chain().focus().toggleBold().run(), state.bold)}
          {button('italic', Italic, () => editor.chain().focus().toggleItalic().run(), state.italic)}
          {button('strike', Strikethrough, () => editor.chain().focus().toggleStrike().run(), state.strike)}
          {button('code', Code, () => editor.chain().focus().toggleCode().run(), state.code)}
          {button('link', Link2, () => { if (state.link) editor.chain().focus().extendMarkRange('link').unsetLink().run(); else { setAddress(''); setLinking(true); } }, state.link)}
        </>}
    </div>
  );
}

/** The "/" menu under the caret. */
function SlashMenu({ slash, index }) {
  const container = usePortalContainer();
  const rect = slash?.clientRect?.();
  if (!slash || !rect || !container || !slash.items.length) return null;
  return createPortal(
    <div role="listbox" aria-label={T.richText.menu} data-rich-slash-menu="" style={{ position: 'fixed', left: rect.left, top: rect.bottom + 6 }}
      className="z-[1000] w-[220px] rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
      {slash.items.map((block, position) => <button key={block.key} type="button" role="option" aria-selected={position === index} onMouseDown={(event) => event.preventDefault()} onClick={() => slash.command(block)}
        className={cn('flex h-8 w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-accent', position === index && 'bg-accent')}>{T.richText.blocks[block.key]}</button>)}
    </div>, container);
}

/**
 * A description that is edited where it stands, as in Linear: no box, no mode. `onChange(markdown)` follows every edit; `onSave(markdown)` runs when the focus leaves after
 * an edit (Escape puts the text back instead); `onSubmit` runs on Cmd/Ctrl+Enter. The text is not rewritten by merely focusing and leaving it.
 */
export function RichText({ value = '', onChange, onSave, onSubmit, label, placeholder, className, autoFocus = false, editable = true }) {
  const known = useRef(value);   // the Markdown the editor and its owner agree on
  const dirty = useRef(false);   // the person has edited it since
  const keep = useRef({ value, onChange, onSave, onSubmit });
  const [slash, setSlash] = useState(null);
  const [index, setIndex] = useState(0);
  const slashRef = useRef({ slash: null, index: 0 });
  // The handlers below run on events, after a render: they read what the last render left here.
  useEffect(() => { keep.current = { value, onChange, onSave, onSubmit }; });
  useEffect(() => { slashRef.current = { slash, index }; });
  const [hooks] = useState(() => ({
    show: (props) => { setSlash(props); setIndex(0); },
    hide: () => setSlash(null),
    key: (event) => {
      const { slash: current, index: at } = slashRef.current;
      if (!current?.items.length) return false;
      if (event.key === 'ArrowDown') { setIndex((at + 1) % current.items.length); return true; }
      if (event.key === 'ArrowUp') { setIndex((at - 1 + current.items.length) % current.items.length); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { current.command(current.items[at]); return true; }
      if (event.key === 'Escape') { setSlash(null); return true; }
      return false;
    },
  }));
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' } }),
      TaskList, TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
      slashExtension(hooks),
    ],
    content: value ?? '', contentType: 'markdown', autofocus: autoFocus ? 'end' : false, editable,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'dudu-rich', role: 'textbox', 'aria-multiline': 'true', ...(label ? { 'aria-label': label } : {}), spellcheck: 'false' },
      handleKeyDown: (view, event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && keep.current.onSubmit) { event.preventDefault(); keep.current.onSubmit(); return true; }
        if (event.key === 'Escape' && !slashRef.current.slash) {
          dirty.current = false;
          view.dom.blur();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      dirty.current = true;
      const markdown = current.getMarkdown().trim();
      known.current = markdown;
      keep.current.onChange?.(markdown);
    },
    onBlur: ({ editor: current }) => {
      setSlash(null);
      if (dirty.current) {
        dirty.current = false;
        keep.current.onSave?.(current.getMarkdown().trim());
      } else if (known.current !== (keep.current.value ?? '')) {
        current.commands.setContent(keep.current.value ?? '', { contentType: 'markdown', emitUpdate: false }); // Escape: the text as it was
        known.current = keep.current.value ?? '';
      }
    },
  });
  // What the owner says the text is changes (it was saved, or somebody else changed it): follow it, unless the person is typing.
  useEffect(() => {
    if (!editor || editor.isDestroyed || (value ?? '') === known.current || editor.isFocused) return;
    known.current = value ?? '';
    editor.commands.setContent(value ?? '', { contentType: 'markdown', emitUpdate: false });
  }, [editor, value]);
  if (!editor) return null;
  return (
    <div className={cn('relative min-w-0 max-w-full', className)} data-rich-text="">
      <EditorContent editor={editor} />
      {editable && <BubbleMenu editor={editor} shouldShow={({ editor: current, from, to }) => current.isFocused && from !== to && !current.isActive('codeBlock')}><FormatBar editor={editor} /></BubbleMenu>}
      {editable && <SlashMenu slash={slash} index={index} />}
    </div>
  );
}
