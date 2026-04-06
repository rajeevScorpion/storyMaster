# Email/Password Auth Log

Status: Phase 1 implemented, verification in progress
Branch: `feat/email-password-auth`

## Phase 0 - Branch And Discovery

Plan
- Create a separate auth branch from `main`.
- Inspect the current auth flow and reuse the current visual language.
- Add auth planning docs before code changes.

Completed
- Created branch `feat/email-password-auth` from `main`.
- Confirmed the current app is Google-only in [AuthProvider.tsx](/d:/AiCoding/storyMaster/components/auth/AuthProvider.tsx).
- Confirmed the unauthenticated landing flow currently redirects directly into Google sign-in from [page.tsx](/d:/AiCoding/storyMaster/app/page.tsx).
- Confirmed the signed-out screen also assumes Google-only re-entry in [SignedOutScreen.tsx](/d:/AiCoding/storyMaster/components/auth/SignedOutScreen.tsx).
- Added this live log and the companion plan doc.

Tradeoffs / Decisions
- Add email/password alongside Google instead of replacing Google.
- Keep auth minimal and visually aligned with the current neutral + emerald theme.
- Keep username-based auth out of scope for this pass.

Verification
- No runtime code changes yet.

Open Risks / Next Step
- Need to implement password recovery carefully so Supabase redirect URLs and update flow line up on stage.

## Phase 1 - Minimal Auth UI And Flow

Plan
- Add a shared minimal auth dialog.
- Keep Google sign-in available.
- Add email/password sign-in, sign-up, and password reset request flow.
- Add a password update page for recovery links.
- Replace Google-only auth fallbacks on the main app entry points.

Completed
- Added shared auth dialog in [AuthDialog.tsx](/d:/AiCoding/storyMaster/components/auth/AuthDialog.tsx).
- Extended [AuthProvider.tsx](/d:/AiCoding/storyMaster/components/auth/AuthProvider.tsx) with:
  - dialog state
  - email/password sign-in
  - email/password sign-up
  - password reset request
  - password update action
- Updated unauthenticated home flow in [page.tsx](/d:/AiCoding/storyMaster/app/page.tsx) to open the auth dialog instead of forcing Google immediately.
- Updated [UserMenu.tsx](/d:/AiCoding/storyMaster/components/auth/UserMenu.tsx) and [SignedOutScreen.tsx](/d:/AiCoding/storyMaster/components/auth/SignedOutScreen.tsx) to use the shared dialog.
- Updated gallery and protected deep-link pages in [page.tsx](/d:/AiCoding/storyMaster/app/gallery/page.tsx), [page.tsx](/d:/AiCoding/storyMaster/app/story/[id]/page.tsx), [page.tsx](/d:/AiCoding/storyMaster/app/explore/[id]/page.tsx), and [StorylinePreview.tsx](/d:/AiCoding/storyMaster/components/story/StorylinePreview.tsx) to use the same dialog-based auth path.
- Added recovery page at [page.tsx](/d:/AiCoding/storyMaster/app/auth/update-password/page.tsx).

Tradeoffs / Decisions
- Chose email/password instead of username/password to stay aligned with Supabase-native auth and keep the UI light.
- Kept Google sign-in as a first-class option rather than replacing it.
- Preserved the existing pending story prompt behavior and avoided auto-starting a story after auth so behavior stays familiar.
- Kept this auth work isolated from pricing and billing changes.

Verification
- `npx tsc --noEmit` passed.
- Targeted ESLint on the auth slice passed:
  - `app/page.tsx`
  - `app/gallery/page.tsx`
  - `app/auth/update-password/page.tsx`
  - `app/story/[id]/page.tsx`
  - `app/explore/[id]/page.tsx`
  - `components/auth/AuthDialog.tsx`
  - `components/auth/AuthProvider.tsx`
  - `components/auth/SignedOutScreen.tsx`
  - `components/auth/UserMenu.tsx`
  - `components/story/StorylinePreview.tsx`
- Full-repo lint still fails for pre-existing issues outside this auth slice, including:
  - [page.tsx](/d:/AiCoding/storyMaster/app/signed-out/page.tsx)
  - [NarrationButton.tsx](/d:/AiCoding/storyMaster/components/story/NarrationButton.tsx)
  - [PromptCarousel.tsx](/d:/AiCoding/storyMaster/components/story/PromptCarousel.tsx)
  - [KissagoLogo.tsx](/d:/AiCoding/storyMaster/components/ui/KissagoLogo.tsx)
  - [useAudioPlayer.ts](/d:/AiCoding/storyMaster/lib/hooks/useAudioPlayer.ts)

Open Risks / Next Step
- Stage still needs Supabase Auth settings aligned for email/password and password reset redirect URLs.
- `.env.example` currently contains real-looking secrets and should not be committed in its present state.
- Need manual stage smoke testing before merge:
  - sign up
  - sign in
  - password reset request
  - password update
  - story begin flow after auth

## Phase 1.1 - Stage Feedback Fixes

Plan
- Fix the story-screen header overlap with the fixed user menu.
- Ensure narration voice stays locked after beat 1 for the rest of the story.

Completed
- Added extra right-side header spacing in [StoryScreen.tsx](/d:/AiCoding/storyMaster/components/story/StoryScreen.tsx) so the fixed user avatar no longer collides with the story action icons.
- Added narrator-voice locking helpers in [narration.ts](/d:/AiCoding/storyMaster/app/actions/narration.ts) to persist the first selected voice onto the story record.
- Updated [story-store.ts](/d:/AiCoding/storyMaster/lib/store/story-store.ts) so later beat narration resolves the locked voice from session or the persisted story record before generating audio.
- Fixed the loaded-story save indicator in [story-store.ts](/d:/AiCoding/storyMaster/lib/store/story-store.ts) so stories loaded from cloud now enter the UI in the `saved` state instead of falling back to the neutral manual-save icon.

Tradeoffs / Decisions
- Kept the user menu fixed and reserved space in the story header rather than redesigning the top-level shell.
- Chose a persistence-backed voice lock so refreshes and later beat generation stay consistent even if the client session temporarily loses `narratorVoice`.

Verification
- `npx eslint components/story/StoryScreen.tsx lib/store/story-store.ts app/actions/narration.ts` passed.
- `npx tsc --noEmit` passed.

Open Risks / Next Step
- The first-beat image save timeout may still need the higher admin threshold you mentioned if stage generation remains slow under load.
- Voice consistency should be rechecked on stage by generating at least two beats on the same story after a fresh page load.
