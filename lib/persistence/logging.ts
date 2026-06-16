export function logPersistenceEvent(event: string, details: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV !== 'development') return;
  console.debug(`[story-persistence] ${event}`, details);
}
