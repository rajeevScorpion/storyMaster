'use client';

import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  /** Compact validation message shown below the row and wired via aria-describedby. */
  error?: string | null;
  disabled?: boolean;
  id?: string;
}

/**
 * A labelled checkbox with a real `<input type="checkbox">` underneath (for
 * autofill/password-manager compatibility and native screen-reader
 * semantics), visually replaced by a small emerald box. No checkbox
 * primitive existed anywhere in the repo before this — every prior checkbox
 * was a raw `<input className="accent-emerald-400">`.
 *
 * The focus ring is drawn with box-shadow, never `ring-*`: per
 * docs/agent-context/GOTCHAS.md, Tailwind v4's `ring-*` defaults its color to
 * `currentColor` rather than the fixed blue v3 used, so on light text it
 * renders white instead of emerald.
 */
export default function Checkbox({ checked, onChange, label, error, disabled, id }: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;

  return (
    <div>
      <label
        htmlFor={inputId}
        className={`flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm leading-relaxed text-neutral-300 ${
          disabled ? 'cursor-not-allowed opacity-60' : ''
        }`}
      >
        <span className="relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          <input
            id={inputId}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange(event.target.checked)}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            className="peer absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-md"
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors ${
              checked ? 'border-emerald-400 bg-emerald-400' : 'border-white/25 bg-white/5'
            } peer-focus-visible:shadow-[0_0_0_3px_rgba(52,211,153,0.35)]`}
          >
            {checked ? <Check className="h-3.5 w-3.5 text-neutral-950" strokeWidth={3} /> : null}
          </span>
        </span>
        <span>{label}</span>
      </label>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
