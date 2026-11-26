import { useState } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { T } from '../strings.js';
import { Group } from './kit.jsx';

const S = T.shell;
// Where the phone app comes from (the links of the design the owner approved, 2026-11-27): the App Store page, which opens in the region of the person (no country in it), the public
// TestFlight link, and the page of the latest GitHub release, which has the apk.
const LINKS = [
  { label: 'App Store', href: 'https://apps.apple.com/app/id6833981505' },
  { label: 'TestFlight', href: 'https://testflight.apple.com/join/TNUPd6n7' },
  { label: 'Android', href: 'https://github.com/weiwenhao/dudu/releases/latest' },
];

/**
 * What a person who has just installed the plugin needs to use the phone: install the app, open it and tap 扫描配对码, then scan the QR code of this page. Style 2 of
 * `.local/designs/phone-guide-2026-11-26/` (owner, 2026-11-27: 「没问题，你实现吧」): a line down the page, a ring for each step (DSH's own step mark), no card. It is open while no
 * phone is paired; once one is, only its caption is there, which unfolds it.
 */
export function ConnectionGuide({ paired }) {
  const [unfolded, setUnfolded] = useState(false);
  const open = !paired || unfolded;
  const title = paired ? (
    <button
      type="button" aria-expanded={open} onClick={() => setUnfolded((value) => !value)}
      className="-mx-1 flex h-6 items-center gap-1 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {S.guide}<ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
    </button>
  ) : S.guide;
  const steps = [S.guideInstall, S.guideOpen, S.guideScan];
  return (
    <Group bare title={title} label={S.guide}>
      {open && (
        <>
          <ol className="flex flex-col px-5">
            {steps.map((step, index) => (
              <li key={step} className={cn('relative flex gap-3.5', index < steps.length - 1 && 'pb-5')}>
                {index < steps.length - 1 && <span aria-hidden="true" className="absolute top-6 bottom-0 left-3 w-px -translate-x-1/2 bg-border" />}
                <span aria-hidden="true" className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-muted-foreground/50 bg-background text-xs font-medium tabular-nums">{index + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
                  <div className="text-sm font-medium [overflow-wrap:anywhere]">{step}</div>
                  {index === 0 && (
                    <>
                      <p className="text-xs/[18px] text-muted-foreground">{S.guideInstallDetail}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {LINKS.map((link) => (
                          <a
                            key={link.label} href={link.href} target="_blank" rel="noreferrer noopener"
                            className="inline-flex items-center gap-0.5 rounded-sm text-xs font-medium text-ring outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >{link.label}<ArrowUpRight className="size-3" aria-hidden="true" /></a>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <p className="px-5 pt-3 pl-[58px] text-xs/[18px] text-muted-foreground">{S.guideNetwork}</p>
        </>
      )}
    </Group>
  );
}
