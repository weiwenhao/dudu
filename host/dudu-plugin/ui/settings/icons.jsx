// The icons of the settings window's pages. Paths from the approved settings design; some differ from the installed Lucide version.
function Icon({ children, ...props }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export const SlidersHorizontal = (props) => <Icon {...props}><path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" /></Icon>;
export const Plug = (props) => <Icon {...props}><path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></Icon>;
export const ListChecks = (props) => <Icon {...props}><path d="m3 17 2 2 4-4M3 7l2 2 4-4M13 6h8M13 12h8M13 18h8" /></Icon>;
export const FileText = (props) => <Icon {...props}><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" /></Icon>;
export const Sparkles = (props) => <Icon {...props}><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0ZM20 3v4M22 5h-4M4 17v2M5 18H3" /></Icon>;
export const Smartphone = (props) => <Icon {...props}><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><path d="M12 18h.01" /></Icon>;
