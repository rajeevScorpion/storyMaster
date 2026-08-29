'use client';

import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

export const DIALOG_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface UseDialogBehaviorOptions {
  isOpen: boolean;
  onClose: () => void;
}

export interface UseDialogBehaviorResult {
  panelRef: RefObject<HTMLDivElement | null>;
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Shared accessible-dialog mechanics, lifted out of Sheet.tsx so Modal.tsx
 * (and Sheet.tsx itself) don't each carry their own copy: background scroll
 * lock while open, focus moved into the panel on open and restored to
 * whatever triggered it on close, and a Tab focus trap. Consumers still own
 * their own portal + animation markup -- Sheet is bottom-anchored,
 * Modal is centered -- only the behavior underneath is shared.
 */
export function useDialogBehavior({ isOpen, onClose }: UseDialogBehaviorOptions): UseDialogBehaviorResult {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Lock background scroll for as long as the dialog is open.
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Move focus in on open and restore it on close.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel)?.focus();

    return () => previouslyFocusedRef.current?.focus?.();
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR) ?? []
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose]
  );

  return { panelRef, handleKeyDown };
}
