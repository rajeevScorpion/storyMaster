// Media-pipeline keys are stories/{userId}/{storyId}/media/... — the story scope
// lives at parts[2]; legacy keys are stories/{storyId}/... with the scope at parts[1].
export function extractMediaObjectScopeCandidates(objectKey: string): string[] {
  const parts = objectKey.split('/').filter(Boolean);
  if (parts[0] !== 'stories' || !parts[1]) return [];
  if (parts[3] === 'media' && parts[2]) return [parts[2], parts[1]];
  return [parts[1]];
}
