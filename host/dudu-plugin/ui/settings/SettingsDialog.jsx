import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button } from '../components/button.jsx';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog.jsx';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { ConnectorsSection } from './ConnectorsSection.jsx';
import { GeneralSection } from './GeneralSection.jsx';
import { MemorySection } from './MemorySection.jsx';
import { RulesSection } from './RulesSection.jsx';
import { SkillsSection } from './SkillsSection.jsx';
import { WidgetsSection } from './WidgetsSection.jsx';

const SECTIONS = ['general', 'connectors', 'rules', 'memory', 'widgets', 'skills'];

/**
 * The settings of 嘟嘟, in the shape of DSH's own: sections on the left, cards on the right, "open the project folder" at the top
 * right. `onChanged` tells the dashboard behind it that a widget was added or removed here.
 */
export function SettingsDialog({ open, onOpenChange, request, onChanged }) {
  const [section, setSection] = useState('general');
  const props = { request, onChanged };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[640px] max-h-[calc(100vh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[920px]">
        <DialogDescription className="sr-only">{T.settings.title}</DialogDescription>
        <div className="flex h-full min-h-0">
          <nav aria-label={T.settings.title} className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r bg-muted/40 p-3">
            <DialogTitle className="px-2 pt-1 pb-3 text-base font-semibold">{T.settings.title}</DialogTitle>
            {SECTIONS.map((id) => (
              <button
                key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}
                className={cn('h-8 rounded-md px-2 text-left outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50', section === id && 'bg-accent font-medium')}
              >
                {T.settings.nav[id]}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-2 px-5">
              <h2 className="font-semibold">{T.settings.nav[section]}</h2>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => request('assistant/open', { name: 'folder' })}><FolderOpen />{T.settings.openFolder}</Button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
              {section === 'general' && <GeneralSection {...props} />}
              {section === 'connectors' && <ConnectorsSection {...props} />}
              {section === 'rules' && <RulesSection {...props} />}
              {section === 'memory' && <MemorySection {...props} />}
              {section === 'widgets' && <WidgetsSection {...props} />}
              {section === 'skills' && <SkillsSection {...props} />}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
