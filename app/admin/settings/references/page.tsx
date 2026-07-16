import ReferenceSettingsPanel from '@/components/admin/ReferenceSettingsPanel';
import { getReferenceAdminState } from '@/app/actions/admin-references';

export const dynamic = 'force-dynamic';

export default async function ReferenceSettingsPage() {
  const initial = await getReferenceAdminState();
  return <ReferenceSettingsPanel initial={initial} />;
}
