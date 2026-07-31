import AdminPageHeader from '@/components/admin/AdminPageHeader';
import AdminUserDirectory from '@/components/admin/users/AdminUserDirectory';
import { getAdminUsersPage } from '@/app/actions/admin-users';
import Link from 'next/link';
import { Megaphone } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const initialData = await getAdminUsersPage({
    page: 1,
    pageSize: 25,
    status: 'all',
  });

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <AdminPageHeader
        title="User management"
        description="Search accounts, review story and wallet health, and manage access safely."
        actions={(
          <Link
            href="/admin/users/cohorts"
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 transition-colors hover:bg-emerald-500/15"
          >
            <Megaphone className="h-4 w-4" />
            Promotional cohorts
          </Link>
        )}
      />
      <AdminUserDirectory initialData={initialData} />
    </div>
  );
}
