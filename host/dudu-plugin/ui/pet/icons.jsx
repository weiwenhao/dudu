// The icons DSH draws for these commands in its own "/" menu (@deepseek-ai/dsh-client-ui-primitives, MIT, (c) 2026 DeepSeek), kept as they are:
// 16px, one-pixel strokes. The owner asked for DSH's icons here (2026-11-01). Context uses DSH's own "context injection" mark.

export function PaperclipIcon({ className }) {
  return <svg viewBox="0 0 16 16" fill="none" strokeWidth="1" aria-hidden="true" className={className}><path d="M12.75 4.5V9.5C12.75 10.7598 12.2496 11.968 11.3588 12.8588C10.468 13.7496 9.25978 14.25 8 14.25C6.74022 14.25 5.53204 13.7496 4.64124 12.8588C3.75045 11.968 3.25 10.7598 3.25 9.5V5C3.25 4.13805 3.59241 3.3114 4.2019 2.7019C4.8114 2.09241 5.63805 1.75 6.5 1.75C7.36195 1.75 8.1886 2.09241 8.7981 2.7019C9.40759 3.3114 9.75 4.13805 9.75 5V9.5C9.75 9.96413 9.56563 10.4092 9.23744 10.7374C8.90925 11.0656 8.46413 11.25 8 11.25C7.53587 11.25 7.09075 11.0656 6.76256 10.7374C6.43437 10.4092 6.25 9.96413 6.25 9.5V5.5" stroke="currentColor" /></svg>;
}

export function CompactIcon({ className }) {
  return <svg viewBox="0 0 16 16" fill="none" strokeWidth="1" aria-hidden="true" className={className}><path opacity="0.35" d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor" /><path d="M8 1.5C8.85359 1.5 9.69883 1.66813 10.4874 1.99478C11.2761 2.32144 11.9926 2.80022 12.5962 3.40381C13.1998 4.00739 13.6786 4.72394 14.0052 5.51256C14.3319 6.30117 14.5 7.14641 14.5 8" stroke="currentColor" /></svg>;
}

export function ContextIcon({ className }) {
  return <svg viewBox="0 0 16 16" fill="none" strokeWidth="1" aria-hidden="true" className={className}><path d="M5 2.5H3.5C3.23478 2.5 2.98043 2.60536 2.79289 2.79289C2.60536 2.98043 2.5 3.23478 2.5 3.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V3.5C13.5 3.23478 13.3946 2.98043 13.2071 2.79289C13.0196 2.60536 12.7652 2.5 12.5 2.5H11" stroke="currentColor" /><path d="M8 0.5V7.5" stroke="currentColor" /><path d="M5.5 5L8 7.5L10.5 5" stroke="currentColor" /><path d="M5.5 11H10.5" stroke="currentColor" /></svg>;
}
