# Capacitor Readiness Notes

## Purpose

This persistence implementation should prepare Kissago for an Android/iOS Capacitor app later.

## Capacitor basics

Capacitor packages a web app inside a native Android/iOS shell and gives access to native APIs through plugins.

For Kissago, the app should eventually work like:

```txt
Bundled mobile UI inside Capacitor
        ↓
Remote APIs on Vercel/Supabase/backend
        ↓
Local story cache on device
        ↓
Native media storage for images/audio
```

## Do not depend on `server.url` for production

Avoid making the native app simply open the live website every time. The better direction is to bundle the UI and call remote APIs.

Investigation required:

```md
Can the current frontend be bundled for Capacitor?
Are story screens client-compatible?
Are there server-only imports in client components?
Does Next.js static export work or is a separate mobile app shell needed?
```

## Capacitor storage compatibility

Capacitor apps can use WebView storage APIs, but serious persistence should not rely only on them.

Recommended path:

```txt
Now, for web:
- IndexedDB for metadata/progress
- Cache Storage for media

Later, for native:
- Capacitor Filesystem for media
- Preferences for tiny settings
- SQLite only if data scale/query needs justify it
```

## Native plugins likely needed later

Do not install without checking repo readiness.

Likely future packages:

```bash
npm install @capacitor/core @capacitor/cli
npm install @capacitor/android
npm install @capacitor/filesystem
npm install @capacitor/preferences
npm install @capacitor/share
```

Potential later:

```bash
npm install @capacitor/push-notifications
npm install @capacitor/splash-screen
npm install @capacitor/status-bar
```

## Android app next-step outline

After persistence is stable:

```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/android
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

But do not run these blindly inside the current repo unless the app build strategy is confirmed.

## File path rendering in Capacitor

Native device file paths must be converted before use in WebView.

Concept:

```ts
import { Capacitor } from '@capacitor/core';

const webViewSafeUrl = Capacitor.convertFileSrc(nativeFileUri);
```

The story player should be designed so this conversion happens inside the persistence/media adapter, not inside every UI component.

## Android media playback checks

Before final Android packaging, test:

- image display from local Filesystem path;
- audio playback from converted local path;
- pause/resume behavior;
- background/foreground app behavior;
- low-storage cleanup;
- logout/cache policy;
- network loss during story playback;
- signed URL refresh.

## iOS future checks

Even if Android is first, avoid blocking iOS:

- do not use Android-only paths in shared code;
- do not assume filesystem behavior is identical;
- do not assume autoplay rules are identical;
- do not assume WebView storage persistence is identical;
- keep native differences inside adapters.

## Capacitor-ready code principles

```txt
Use platform detection only inside adapters.
Keep story UI platform-agnostic.
Keep persistence behind interfaces.
Keep server sync independent from storage backend.
Keep cache invalidation based on story/asset version, not platform.
```
