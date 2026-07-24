import { redirect } from 'next/navigation';
import { verifyAdmin } from '@/lib/supabase/admin';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import AdminMobileNav from '@/components/admin/AdminMobileNav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await verifyAdmin();
  } catch {
    redirect('/');
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100 md:flex-row">
      <AdminMobileNav />
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-10">
        {children}
      </main>
    </div>
  );
}
