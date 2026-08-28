import 'server-only';

import { getManagedPageByKey } from '@/lib/managed-pages/service';
import { createAdminClient } from '@/lib/supabase/admin';

export type ManagedPageChangeType = 'minor' | 'material';

/**
 * Snapshots the page's current title/content/excerpt/doc_version/effective_date
 * into an append-only managed_page_versions row, then stamps published_at and
 * -- for a 'material' change only -- sets reacceptance_required so the consent
 * gate (lib/legal/consent.ts) starts demanding the new version from users who
 * already accepted an older one. A 'minor' change (typo, contact info) leaves
 * reacceptance_required false: existing acceptances of an earlier version keep
 * satisfying the gate, matching the pack's own example policy.
 *
 * Requires the page to already have a doc_version and acceptanceKind saved --
 * publishing is a distinct step from drafting so an admin can iterate on
 * content before committing a version to the acceptance ledger.
 */
export async function publishManagedPageVersion(
  pageKey: string,
  changeType: ManagedPageChangeType,
  publishedBy: string
): Promise<void> {
  const page = await getManagedPageByKey(pageKey);
  if (!page) throw new Error('Unknown managed system page.');
  if (!page.docVersion) throw new Error('Save a document version before publishing.');
  if (!page.acceptanceKind) throw new Error('Save an acceptance kind before publishing.');

  const supabase = createAdminClient();

  const { error: versionError } = await supabase.from('managed_page_versions').insert({
    page_key: page.pageKey,
    doc_version: page.docVersion,
    title: page.title,
    content: page.content,
    excerpt: page.excerpt,
    effective_date: page.effectiveDate,
    change_type: changeType,
    published_by: publishedBy,
  });

  if (versionError) {
    // UNIQUE(page_key, doc_version) -- re-publishing the same version number is
    // almost always a mistake (bump the version instead of overwriting history).
    if (versionError.code === '23505') {
      throw new Error(`Version ${page.docVersion} has already been published for this page. Use a new version number.`);
    }
    throw new Error(`Failed to record the published version: ${versionError.message}`);
  }

  const { error: updateError } = await supabase
    .from('managed_pages')
    .update({
      published_at: new Date().toISOString(),
      reacceptance_required: changeType === 'material',
    })
    .eq('page_key', page.pageKey);

  if (updateError) {
    throw new Error(`Version was recorded, but failed to update the page's publish state: ${updateError.message}`);
  }
}
