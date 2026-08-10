'use client';

import { type LucideIcon } from 'lucide-react';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  /**
   * Fills its container from `lg` up. On by default because the form layouts
   * that came first rely on it; the gallery filter row wants it content-sized,
   * sitting left with the dropdowns rather than stretching across the page.
   */
  stretch?: boolean;
}

/**
 * Compact pill segmented control. On mobile each option renders as an icon-only
 * button (when an icon is provided); from `lg` up the text label is shown instead,
 * keeping the desktop layout unchanged. An `aria-label`/`title` is always present
 * so icon-only buttons stay accessible.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  stretch = true,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex w-fit rounded-full bg-black/30 p-1 ${stretch ? 'lg:w-full' : ''} ${className ?? ''}`}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
            className={`flex flex-none items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition lg:py-2 ${
              stretch ? 'lg:flex-1' : ''
            } ${
              active ? 'bg-emerald-400 text-neutral-950' : 'text-neutral-300 hover:bg-white/10'
            }`}
          >
            {Icon ? (
              <Icon className="h-4 w-4 shrink-0 lg:hidden" aria-hidden="true" />
            ) : null}
            <span className={Icon ? 'hidden lg:inline' : ''}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
