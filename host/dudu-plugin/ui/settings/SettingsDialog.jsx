import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { ConnectorsSection } from './ConnectorsSection.jsx';
import { GeneralSection } from './GeneralSection.jsx';
import { MemorySection } from './MemorySection.jsx';
import { RulesSection } from './RulesSection.jsx';
import { SkillsSection } from './SkillsSection.jsx';
import { WidgetsSection } from './WidgetsSection.jsx';
import { FileText, Layers, LayoutGrid, ListChecks, Plug, SlidersHorizontal, Smartphone, Sparkles } from './icons.jsx';

const SECTIONS = ['general', 'connectors', 'rules', 'memory', 'skills', 'widgets'];
const ICONS = { general: SlidersHorizontal, connectors: Plug, rules: ListChecks, memory: FileText, skills: Sparkles, widgets: LayoutGrid, phone: Smartphone, providers: Layers };

/**
 * The approved settings layout: sections on the left, cards on the right, "open the project folder" at the top
 * right. `onChanged` tells the dashboard behind it that a widget was added or removed here.
 */
export function SettingsDialog({ open, onOpenChange, request, actions = {}, onChanged, registry, widgetProblems, extraSections = {} }) {
  const [section, setSection] = useState('general');
  const Extra = extraSections[section];
  const props = { request, actions, onChanged, registry, widgetProblems, onClose: () => onOpenChange(false) };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent overlayClassName="bg-black/25 dark:bg-black/65" className="dudu-settings h-[784px] max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden rounded-[28px] border-0 p-0 shadow-none sm:max-w-[800px]">
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
            {[...SECTIONS, ...['phone', 'providers'].filter((id) => extraSections[id])].map((id) => {
              const Icon = ICONS[id];
              return (
              <button
                key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}
                aria-label={T.settings.nav[id]} title={T.settings.nav[id]}
                className={cn('flex h-10 items-center gap-3 rounded-xl px-3 text-left text-[14px] outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', section === id && 'bg-accent')}
              >
                <Icon className="size-[18px] shrink-0" strokeWidth={1.7} aria-hidden="true" /><span className="max-sm:hidden">{T.settings.nav[id]}</span>
              </button>
            ); })}
          </nav>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto pt-1.5 pr-6 pb-6 pl-3">
              {section === 'general' && <GeneralSection {...props} />}
              {section === 'connectors' && <ConnectorsSection {...props} />}
              {section === 'rules' && <RulesSection {...props} />}
              {section === 'memory' && <MemorySection {...props} />}
              {section === 'widgets' && <WidgetsSection {...props} />}
              {section === 'skills' && <SkillsSection {...props} />}
              {Extra && <Extra embedded />}
            </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
