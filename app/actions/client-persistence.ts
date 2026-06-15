'use server';

import { getFeatureFlag } from '@/lib/ai/model-config';

export async function getClientStoryPersistenceEnabled(): Promise<boolean> {
  return getFeatureFlag('client_story_persistence_enabled', false);
}
