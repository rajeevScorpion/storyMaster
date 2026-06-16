# Clarifying Questions to Ask Before Risky Decisions

The coder should ask questions only when the codebase investigation cannot answer them or when the decision changes product/backend behavior.

## Product questions

1. Should stories be playable offline automatically, or only after user taps “Save offline”?
2. How many stories should be cached automatically per user/device?
3. Should cached stories remain after logout?
4. Should users be able to manually remove downloaded stories?
5. Should parent/child profiles share cached stories on one device?
6. Should generated story media be considered private or safe to cache as public immutable assets?

## Backend/storage questions

1. Where are story images stored?
2. Where are story audio files stored?
3. Are image/audio URLs public, signed, or proxied?
4. If signed, what is the expiry duration?
5. Can the backend return stable `assetId`, `hash`, `version`, and `byteSize`?
6. Are generated assets ever overwritten at the same path?
7. Can immutable generated assets use long cache headers?
8. Can story manifests expose `schemaVersion` and `contentHash`?

## Auth/security questions

1. Is story content private per user?
2. Can cached story content be visible after logout?
3. Should cached data be cleared when account changes?
4. Are there compliance/privacy requirements for child-oriented content?
5. Should sensitive data ever be encrypted locally?

## Capacitor questions

1. Is Android first, iOS later?
2. Will the app bundle the UI or load the live website?
3. Is the current Next.js app compatible with Capacitor bundling?
4. Is a separate mobile shell acceptable if the current web app is too server-rendered?
5. Should native offline storage be implemented now or after Android packaging starts?

## Technical questions

1. Is React Query/SWR already used for story fetching?
2. Is there already a service worker/PWA setup?
3. Is there an existing global store for story player state?
4. Are image/audio components centralized or scattered?
5. Can media fetching be routed through one helper function?
6. Are there tests in the repo, and what test runner is used?

## Required behavior if questions are unanswered

If a question affects data privacy, auth, storage location, signed URL strategy, or story schema, do not guess. Ask the user/team before implementing that part.

If a question only affects implementation details and the repo clearly indicates a pattern, proceed with the repo-consistent choice and document the decision.
