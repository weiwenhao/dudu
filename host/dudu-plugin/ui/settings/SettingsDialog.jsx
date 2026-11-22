import { useState } from 'react';
import { Bot, Brain, CircleDashed, Cog, Rss, Split, X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { ConnectorsPage } from '../connectors/ConnectorsPage.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { CollectorsSection } from './CollectorsSection.jsx';
import { GeneralSection } from './GeneralSection.jsx';
import { Plug, Smartphone, Sparkles } from './icons.jsx';
import { MemorySection } from './MemorySection.jsx';
import { PhoneSection } from './PhoneSection.jsx';
import { ProvidersSection } from './ProvidersSection.jsx';
import { RulesSection } from './RulesSection.jsx';
import { SkillsSection } from './SkillsSection.jsx';
import { StatusesSection } from './StatusesSection.jsx';

// Two groups of pages, with a line between them: what 嘟嘟 does with the work (and keeps), then how it reaches this computer's phone and agents.
const PAGES = {
  general: { Icon: Cog, Page: GeneralSection },
  statuses: { Icon: CircleDashed, Page: StatusesSection },
  connectors: { Icon: Plug, Page: ConnectorsPage },
  collectors: { Icon: Rss, Page: CollectorsSection },
  rules: { Icon: Split, Page: RulesSection },
  memory: { Icon: Brain, Page: MemorySection },
  skills: { Icon: Sparkles, Page: SkillsSection },
  phone: { Icon: Smartphone, Page: PhoneSection },
  providers: { Icon: Bot, Page: ProvidersSection },
};
const NAV = [['general', 'statuses', 'connectors', 'collectors', 'rules', 'memory', 'skills'], ['phone', 'providers']];

/**
 * The approved settings layout: pages on the left, cards on the right, "open the project folder" at the top right. The one place 嘟嘟 is
 * set up: DSH's own settings window has nothing of it.
 */
export function SettingsDialog({ open, onOpenChange, request, actions = {}, onChanged }) {
  const [section, setSection] = useState('general');
  const { Page } = PAGES[section];
  const props = { request, actions, onChanged, onClose: () => onOpenChange(false) };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent overlayClassName="bg-black/25 dark:bg-black/65" className="dudu-settings h-[784px] max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden rounded-[28px] border-0 p-0 shadow-none sm:max-w-[800px]"
        onEscapeKeyDown={(event) => { if (event.target instanceof Element && event.target.closest('[data-status-form], [data-inline-form]')) event.preventDefault(); }}>
        <DialogDescription className="sr-only">{T.settings.title}</DialogDescription>
        <header className="flex h-[68px] shrink-0 items-center justify-between gap-3 pt-2 pr-[22px] pl-[34px]">
          <DialogTitle className="text-[18px]/7 font-semibold">{T.settings.title}</DialogTitle>
          <div className="flex items-center gap-2.5">
            <Button variant="outline" size="sm" className="rounded-lg" onClick={() => request('assistant/open', { name: 'folder' })}>{T.settings.openFolder}</Button>
            <DialogClose asChild><Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label={T.pet.close}><X /></Button></DialogClose>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 pt-2 pl-3">
          <nav aria-label={T.settings.title} className="flex w-[188px] shrink-0 flex-col gap-1 pr-3 max-sm:w-[52px]">
            {NAV.map((ids, group) => (
              <div key={group} className={cn('flex flex-col gap-1', group > 0 && 'mt-1.5 border-t border-border/70 pt-2.5')}>
                {ids.map((id) => {
                  const { Icon } = PAGES[id];
                  return (
                    <button
                      key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}
                      aria-label={T.settings.nav[id]} title={T.settings.nav[id]}
                      className={cn('flex h-10 items-center gap-3 rounded-xl px-3 text-left text-[14px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', section === id && 'bg-accent')}
                    >
                      <Icon className="size-[18px] shrink-0" strokeWidth={1.7} aria-hidden="true" /><span className="max-sm:hidden">{T.settings.nav[id]}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto pt-1.5 pr-6 pb-6 pl-3">
            <Page key={section} {...props} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
