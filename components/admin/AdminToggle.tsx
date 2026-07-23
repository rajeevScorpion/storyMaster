'use client';

// Canonical admin toggle switch. Geometry matches the GlobalSettings ToggleRow
// switch; replaces the divergent hand-rolled toggles across the admin UI so
// they read as one component. Visual-only — callers keep their own handlers.
export default function AdminToggle({
  checked,
  onToggle,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-50 ${checked ? 'bg-emerald-500' : 'bg-neutral-600'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`}
      />
    </button>
  );
}
