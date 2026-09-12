import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  dismissOnBackdrop?: boolean;
}
const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Shared focus trap. Callback changes and auto-save rerenders never reset focus. */
export function Modal({ isOpen, onClose, labelledBy, children, className = 'max-w-2xl', dismissOnBackdrop = true }: ModalProps) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!isOpen) return;
    const dialog = root.current!;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => !element.closest('[hidden], [inert]'));
    (focusable()[0] ?? dialog).focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0] ?? dialog;
      const last = items.at(-1) ?? dialog;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const handleFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) (focusable()[0] ?? dialog).focus();
    };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', handleFocus);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', handleFocus);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={(event) => { if (dismissOnBackdrop && event.target === event.currentTarget) onClose(); }}>
      <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        className={`rounded-lg shadow-2xl w-full mx-4 max-h-[90vh] overflow-y-auto ${className}`}
        style={{ backgroundColor: 'var(--color-bg-secondary)' }}>{children}</div>
    </div>
  );
}
