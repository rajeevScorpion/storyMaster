import { redirect } from 'next/navigation';
import { verifyAdmin } from '@/lib/supabase/admin';
import { AdminSidebar } from '@/components/admin/AdminSidebar';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await verifyAdmin();
  } catch {
    redirect('/');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex">
      <AdminSidebar />
      <main className="flex-1 min-h-screen overflow-y-auto p-6 md:p-10">
        {children}
      </main>
    </div>
  );
}
