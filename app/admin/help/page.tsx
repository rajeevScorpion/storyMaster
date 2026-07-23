import { promises as fs } from 'fs';
import path from 'path';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { renderAdminManual } from '@/lib/admin/manual-render';

export const dynamic = 'force-dynamic';

export default async function AdminHelpPage() {
  const filePath = path.join(process.cwd(), 'docs', 'admin-settings-manual.md');
  let markdown: string;
  try {
    markdown = await fs.readFile(filePath, 'utf8');
  } catch {
    markdown = '# Admin manual\n\nThe manual file could not be loaded on this deployment.';
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <AdminPageHeader
        title="Admin manual"
        description="Operator guide for every admin page and setting. Source: docs/admin-settings-manual.md"
      />
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">{renderAdminManual(markdown)}</div>
    </div>
  );
}
