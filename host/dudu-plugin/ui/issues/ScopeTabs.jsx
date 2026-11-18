import { useLayoutEffect, useRef } from 'react';
import { Tabs } from 'radix-ui';
import { Button } from '../components/button.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';

/**
 * The tabs of the conversation list, as the phone's board has them (owner, 2026-11-18: "这里的还没有和升级同步"; the phone's row is Lark's message filter row): a grey track, the chosen tab a white pill with a thin
 * grey edge, every tab's words the same grey, and the pill slides to the tab that is chosen. The pill is one box that is moved, not one in each tab: each tab says where it is (`offsetLeft`, `offsetWidth`) and the
 * box is put there by hand, as the DOM it is (no state to render again); the first place is taken without moving, the moves after it are animated (`data-moves`). Must sit inside `Tabs.Root`.
 */
export function ScopeTabs({ tabs, value, label }) {
  const list = useRef(null);
  const pill = useRef(null);
  useLayoutEffect(() => {
    const element = list.current;
    const box = pill.current;
    if (!element || !box) return undefined;
    const place = () => {
      const chosen = element.querySelector('[role="tab"][data-state="active"]');
      box.style.opacity = chosen ? '1' : '0';
      if (!chosen) return;
      box.style.width = `${chosen.offsetWidth}px`;
      box.style.transform = `translateX(${chosen.offsetLeft}px)`;
      if (!box.dataset.moves) requestAnimationFrame(() => { box.dataset.moves = 'true'; });
    };
    place();
    // A tab's width changes when the font arrives or the language changes: the pill follows it.
    const observer = new ResizeObserver(place);
    observer.observe(element);
    for (const tab of element.querySelectorAll('[role="tab"]')) observer.observe(tab);
    return () => observer.disconnect();
  }, [value, tabs]);
  return <Tabs.List ref={list} aria-label={label} className="relative flex min-w-0 items-center overflow-x-auto rounded-full bg-muted p-0.5 [scrollbar-width:none]">
    <span ref={pill} aria-hidden="true" style={{ opacity: 0 }}
      className="pointer-events-none absolute inset-y-0.5 left-0 rounded-full bg-background ring-1 ring-inset ring-foreground/15 data-[moves]:transition-[transform,width] data-[moves]:duration-300 data-[moves]:ease-[cubic-bezier(.4,0,.2,1)] motion-reduce:transition-none" />
    {tabs.map((id) => (
      <Tabs.Trigger key={id} value={id} asChild>
        <Button variant="ghost" size="xs"
          className={cn('relative z-[1] rounded-full px-2 text-muted-foreground hover:bg-transparent dark:hover:bg-transparent focus-visible:ring-inset',
            value === id ? 'font-medium hover:text-muted-foreground' : 'font-normal hover:text-foreground')}>{T.tabs[id]}</Button>
      </Tabs.Trigger>
    ))}
  </Tabs.List>;
}
