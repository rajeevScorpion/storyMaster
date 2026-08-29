# Testing and QA Checklist

## Basic story loading

- [ ] New story opens from server correctly.
- [ ] Existing story opens from local manifest first.
- [ ] Story text displays correctly from cache.
- [ ] Story page order is correct.
- [ ] Missing local manifest falls back to server.

## Image caching

- [ ] First story load downloads images.
- [ ] Second story load reuses cached images where possible.
- [ ] Missing image shows fallback/placeholder and retries.
- [ ] Changed image version/hash refreshes image.
- [ ] Old image version is not shown after refresh.

## Audio caching

- [ ] First story load downloads/streams audio.
- [ ] Second story load reuses cached audio where possible.
- [ ] Audio play/pause still works.
- [ ] Progress restore does not break audio playback.
- [ ] Changed audio version/hash refreshes audio.
- [ ] Missing audio falls back to remote URL.

## Playback progress

- [ ] Current page is saved.
- [ ] Current audio time is saved if supported.
- [ ] Completed story is marked complete.
- [ ] Reopening story offers continue/resume behavior.
- [ ] Progress survives refresh/app restart.

## Offline behavior

- [ ] Fully cached story can open without network.
- [ ] Metadata-only story handles offline media gracefully.
- [ ] App does not crash when network is lost mid-playback.
- [ ] App resumes downloads when network returns.

## Sync and invalidation

- [ ] Same server version keeps cache.
- [ ] New server version updates manifest.
- [ ] Changed asset downloads again.
- [ ] Unchanged asset is not downloaded again.
- [ ] Signed URL expiry is handled if applicable.

## Storage cleanup

- [ ] Cleanup removes old non-saved stories.
- [ ] Cleanup preserves currently open story.
- [ ] Cleanup preserves explicitly saved offline stories.
- [ ] Storage estimate works where supported.
- [ ] Cache does not grow indefinitely.

## Auth/logout behavior

Product decision required first.

- [ ] Logout policy is defined.
- [ ] Private cached story behavior follows policy.
- [ ] Cached media is not exposed to wrong user.
- [ ] Switching accounts does not show another user’s private cache.

## Mobile browser checks

- [ ] Android Chrome story replay works.
- [ ] iOS Safari story replay works.
- [ ] Audio begins only after valid user gesture where required.
- [ ] Refresh/reopen behavior works.
- [ ] Low network mode still degrades gracefully.

## Capacitor future checks

When Capacitor is added:

- [ ] Android WebView can render story UI.
- [ ] Capacitor Filesystem can download image.
- [ ] Local image path can be displayed after `convertFileSrc`.
- [ ] Capacitor Filesystem can download audio.
- [ ] Local audio path can be played after `convertFileSrc`.
- [ ] App restart keeps saved stories.
- [ ] App uninstall removes app-owned files.

## Performance checks

Record before/after:

```md
First load time before:
Second load time before:
First load time after:
Second load time after:
Media transfer first load:
Media transfer second load:
Cache hit rate:
```

## Regression checks

- [ ] Story creation still works.
- [ ] Story sharing still works.
- [ ] Story library still works.
- [ ] Server sync still works.
- [ ] Error states still show meaningful messages.
- [ ] No hydration/client-server errors introduced.
