// The icons of the settings window's pages. Paths from the approved settings design; some differ from the installed Lucide version.
function Icon({ children, ...props }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export const Plug = (props) => <Icon {...props}><path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></Icon>;
export const Sparkles = (props) => <Icon {...props}><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0ZM20 3v4M22 5h-4M4 17v2M5 18H3" /></Icon>;
export const Smartphone = (props) => <Icon {...props}><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><path d="M12 18h.01" /></Icon>;
