// shadcn/ui Calendar: react-day-picker with shadcn's classes. react-day-picker's own stylesheet is not used; every part is
// styled here, so it lives under `.dudu` like the rest.
import { DayPicker } from 'react-day-picker';
import { enUS, zhCN } from 'react-day-picker/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn.js';
import { getLocale } from '../lib/locale.mjs';

const navButton = 'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function Calendar({ className, classNames, showOutsideDays = true, ...props }) {
  return (
    <DayPicker
      locale={getLocale() === 'zh' ? zhCN : enUS}
      showOutsideDays={showOutsideDays} className={cn('p-1', className)}
      classNames={{
        months: 'relative flex flex-col', month: 'flex w-full flex-col gap-2',
        month_caption: 'flex h-7 items-center justify-center', caption_label: 'text-sm font-medium',
        nav: 'absolute inset-x-0 top-0 flex h-7 items-center justify-between', button_previous: navButton, button_next: navButton,
        month_grid: 'w-full border-collapse', weekdays: 'flex', weekday: 'w-8 flex-1 text-center text-xs font-normal text-muted-foreground',
        week: 'mt-1 flex w-full', day: 'group/day relative flex-1 p-0 text-center text-sm',
        day_button: 'inline-flex size-8 items-center justify-center rounded-md font-normal outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 group-data-[selected=true]/day:bg-primary group-data-[selected=true]/day:text-primary-foreground group-data-[selected=true]/day:hover:bg-primary',
        today: 'font-semibold text-foreground', outside: 'text-muted-foreground/60', disabled: 'opacity-40', hidden: 'invisible',
        ...classNames,
      }}
      components={{ Chevron: ({ orientation }) => (orientation === 'left' ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />) }}
      {...props}
    />
  );
}
