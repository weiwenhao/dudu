import { Children, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import { splitByTerms } from './highlight.js';
import { textMatch } from '../../../conversation-search.mjs';

// A conversation is somebody else's words: raw HTML is shown as text (react-markdown's default), an unsafe link target is dropped, and an
// image is not fetched (its description stands in), so previewing a session never makes the page ask the network for anything.
// remark-cjk-friendly: without it `**注意：**请先` keeps its asterisks, because CommonMark does not count a full-width colon as the edge of a word.
const PLUGINS = [remarkGfm, remarkCjkFriendly];

/** `text` with the words of a search marked. */
export function Highlighted({ text, terms }) {
  return splitByTerms(text, terms).map((piece, index) => piece.hit
    ? <mark key={index} data-session-search-match={textMatch(piece.text, terms.join(' '))?.exact || undefined}
        className="rounded-[3px] bg-[color-mix(in_oklab,#facc15_38%,transparent)] px-px text-inherit">{piece.text}</mark>
    : piece.text);
}

const marked = (children, terms) => (terms.length ? Children.map(children, (child) => (typeof child === 'string' ? <Highlighted text={child} terms={terms} /> : child)) : children);

function componentsFor(terms) {
  const block = (Tag, className) => function Block({ children }) { return <Tag className={className}>{marked(children, terms)}</Tag>; };
  const heading = block('p', 'my-3 text-[14px]/5 font-semibold first:mt-0');
  return {
    p: block('p', 'my-2 first:mt-0 last:mb-0'),
    ul: block('ul', 'my-2 list-disc pl-5 first:mt-0 last:mb-0 marker:text-muted-foreground'),
    ol: block('ol', 'my-2 list-decimal pl-5 first:mt-0 last:mb-0 marker:text-muted-foreground'),
    li: block('li', 'my-0.5 pl-0.5'),
    strong: block('strong', 'font-semibold'),
    em: block('em', 'italic'),
    del: block('del', 'line-through'),
    h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
    blockquote: block('blockquote', 'my-2 border-l-2 pl-3 text-muted-foreground'),
    hr: () => <hr className="my-3" />,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2">{marked(children, terms)}</a>,
    img: ({ alt }) => (alt ? <span className="text-muted-foreground">{alt}</span> : null),
    code: ({ children }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{marked(children, terms)}</code>,
    pre: ({ children }) => <pre className="my-2 overflow-auto rounded-lg bg-muted p-3 font-mono text-[13px]/5 [&_code]:rounded-none [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
    table: ({ children }) => <div className="my-2 overflow-auto"><table className="w-full border-collapse text-[13px]">{children}</table></div>,
    th: ({ children }) => <th className="border px-2 py-1 text-left font-semibold">{marked(children, terms)}</th>,
    td: ({ children }) => <td className="border px-2 py-1 align-top">{marked(children, terms)}</td>,
  };
}

/** What an agent said, with its bold, lists and code shown as such; the words of a search are marked in it. */
export function Markdown({ text, terms = [] }) {
  const key = terms.join('\u0000');
  const components = useMemo(() => componentsFor(terms), [key]); // eslint-disable-line react-hooks/exhaustive-deps -- the words are represented by `key`
  return <div className="text-sm leading-[22px] break-words [overflow-wrap:anywhere]"><ReactMarkdown remarkPlugins={PLUGINS} components={components}>{text}</ReactMarkdown></div>;
}
