import ImageBatchScopeSettings from '@/components/admin/ImageBatchScopeSettings';
import { getImageBatchScopeAdmin } from '@/app/actions/image-batch-admin';

export const dynamic = 'force-dynamic';

export default async function ImageBatchSettingsPage() {
  const initial = await getImageBatchScopeAdmin();
  return <ImageBatchScopeSettings initial={initial} />;
}
