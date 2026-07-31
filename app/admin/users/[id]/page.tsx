import { notFound } from 'next/navigation';
import AdminUserDetail from '@/components/admin/users/AdminUserDetail';
import { getAdminUserDetail } from '@/app/actions/admin-users';

export const dynamic = 'force-dynamic';

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAdminUserDetail(id);
  if (!detail) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <AdminUserDetail initialData={detail} />
    </div>
  );
}
