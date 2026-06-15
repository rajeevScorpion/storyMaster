'use client';

import { WebStoryPersistenceAdapter } from './web-adapter';
import type { StoryPersistence } from './types';

let singleton: StoryPersistence | null = null;

export function createStoryPersistence(): StoryPersistence {
  // A future Capacitor adapter is selected here, keeping platform checks out of readers.
  return new WebStoryPersistenceAdapter();
}

export function getStoryPersistence(): StoryPersistence {
  singleton ??= createStoryPersistence();
  return singleton;
}

export * from './identity';
export * from './manifest';
export * from './types';
