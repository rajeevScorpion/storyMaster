# Sources and Reference Notes

These references are for the implementation team. Always verify against the version of Capacitor and dependencies actually used in the Kissago repo.

## Capacitor

- Capacitor homepage and setup overview: https://capacitorjs.com/
- Capacitor storage guide: https://capacitorjs.com/docs/guides/storage
- Capacitor Filesystem API: https://capacitorjs.com/docs/apis/filesystem
- Capacitor JavaScript utilities, including `convertFileSrc`, `getPlatform`, and `isNativePlatform`: https://capacitorjs.com/docs/basics/utilities

## Key takeaways to verify during implementation

- Capacitor apps run mainly inside a WebView, so normal web storage APIs may be available.
- Capacitor’s storage guide warns that localStorage should be treated as temporary/transient, and IndexedDB can also have persistence caveats, especially on iOS.
- Capacitor Preferences is suitable for small key-value data, not large story/media storage.
- For large or high-performance structured storage, SQLite is a common native direction.
- Capacitor Filesystem is the better fit for downloaded image/audio files in a native app.
- Native file paths need to be converted before being used inside the WebView.

## Browser storage references

- MDN IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN Cache API: https://developer.mozilla.org/en-US/docs/Web/API/Cache
- MDN StorageManager estimate: https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate

## CDN/cache headers to verify in current backend

- Supabase Storage cache control / CDN behavior depends on the current implementation and upload options.
- Cloudflare/Vercel cache behavior depends on the current routing and response headers.
- Do not change cache headers without checking current storage privacy and signed URL behavior.
