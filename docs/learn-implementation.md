# Kissago `/learn` implementation report

## Codebase audit

- **Framework and routing:** Next.js 15 App Router with React 19. Public pages are a mix of server and client components. The learning shell is a static route with a client-side interaction layer.
- **Visual system:** The product uses Tailwind CSS v4 utilities rather than a separate token package. Its established palette is neutral-950/900 surfaces, emerald creation and action states, amber warmth, white borders at low opacity, and sparse shadow-based glow.
- **Typography:** Inter is exposed as `--font-sans`; Playfair Display is exposed as `--font-serif`. Kissago already uses the serif for story-led headings and the sans face for controls and supporting copy.
- **Shared components:** `KissagoLogo` is reused directly. Existing route and button conventions are composed with `next/link`, the same surface utilities, and the same rounded control language. Existing story components are intentionally not embedded because they depend on live auth, store, and story data.
- **Motion:** The application already ships `motion/react`. Existing entrances favor opacity, small translation, and short spring or easing transitions. The route uses the same package and disables spatial movement when reduced motion is requested.
- **Theme:** The current product is globally dark (`bg-neutral-950`); there is no user-facing light-mode switch or alternate token set to integrate.
- **Responsive foundations:** Existing safe-area variables and dynamic viewport conventions are reused. The new route adds isolated mobile portrait and short landscape layouts without changing global CSS.
- **Product routes:** `/` is the live creation entry and `/gallery` is the available public exploration route. No separate guided-demo route exists, so no unavailable CTA is shown.
- **Screenshot opportunities:** Idea entry, beat structure, character setup, playback, and scene refinement exist in the product, but the supplied pack contains no privacy-reviewed stable captures. The implementation includes typed screenshot slots and deliberately uses code-native product-flow compositions as the fallback.

## Reuse and architecture map

| Concern | Reused | New, route-scoped implementation |
| --- | --- | --- |
| Identity | `KissagoLogo` | Learn top bar and presentation treatment |
| Typography and color | Global Inter/Playfair variables, neutral/emerald/amber utilities | Semantic emerald/ember slide accents |
| Motion | `motion/react`, existing easing character | Active-slide entrances and reduced-motion fallback |
| Routing | Next.js App Router and `next/link` | `/learn`, `/tutorial` redirect, stable hashes |
| Media | `next/image` | Optimized learning backgrounds and screenshot-slot registry |
| Navigation | Native browser history and scroll behavior | Snap viewport, chapter progress, explicit controls, wheel/keyboard/touch support |

The slide copy and ordering live in `lib/learn/content.ts`. Navigation parsing and clamping are isolated in `lib/learn/navigation.ts` and covered by unit tests. `LearnExperience` owns route state and input handling; `LearnVisual` owns reusable visual compositions.

## Implemented behavior

- 18 slides across the requested Why, How, and Build chapters.
- Native horizontal scrolling with CSS snap and touch swipe.
- Left/right arrows, Page Up/Page Down, Home/End, previous/next controls, and carefully scoped vertical-wheel translation.
- Stable `#slide-01` through `#slide-18` links plus named slide and chapter hash parsing.
- Push-state navigation for explicit controls and replace-state synchronization for native swipe/scroll.
- `/tutorial` redirects to `/learn`; browser fragments are retained by the redirecting browser.
- Optional `?present=1` presentation mode with Escape to exit.
- Chapter and whole-journey progress, current-slide announcement, semantic slide labels, focus styles, inert off-screen slides, and expandable secondary context.
- Mobile-safe internal vertical scrolling so copy and visuals remain readable instead of being scaled down.
- Seven supplied backgrounds converted to 33–62 KB WebP assets; only the first two are eagerly loaded and all other images remain lazy.
- Typed authentic-screenshot slots through `LEARN_SCREENSHOT_ASSETS`. Empty slots render complete code-native fallbacks and never imply a nonexistent product screen.

## Validation

- `npm test`: **57 files and 348 tests passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run lint`: **passed with no errors**. One pre-existing `react-hooks/exhaustive-deps` warning remains in `components/story/AdvancedOptions.tsx:211`.
- `npm run build`: **passed**. `/learn` is statically generated at 13.9 KB route size and 165 KB first-load JavaScript in the validation build.
- Route smoke test: `/learn` returned **200** and `/tutorial` returned **307** to `/learn`.
- Browser review: checked at 1440 × 900 desktop and narrow mobile layouts, including direct entry to slide 6 and redirect-plus-fragment behavior.

Final captures:

- `docs/screenshots/learn-desktop.png`
- `docs/screenshots/learn-mobile.png`

## Known limitation and asset handoff

Authentic in-product screenshots were not added because the pack's screenshot directory is empty and generating captures from live authenticated data would risk unstable or private content. To add approved captures later, place optimized files under `public/learn/screenshots` and register their source, alt text, and caption in `LEARN_SCREENSHOT_ASSETS`. The corresponding slides will automatically replace their fallback composition.
