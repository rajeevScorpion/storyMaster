import type { ReactNode } from 'react';

// Canonical admin page header. One heading standard across admin: text-2xl
// font-serif (marries the hub pages' size with the standalone pages' serif).
export default function AdminPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-serif text-neutral-100">{title}</h1>
        {description && <p className="mt-1 text-sm text-neutral-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
