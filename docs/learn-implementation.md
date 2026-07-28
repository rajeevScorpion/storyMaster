# Kissago `/learn` presentation report

## Combined presentation

The original learning journey and `assets/kissago-pitch-deck.html` are now one 20-slide presentation for product collaborators, pilot partners and investors. The story is organised into four sections:

| Section | Slides | Purpose |
| --- | ---: | --- |
| The Opportunity | 1–5 | Establish the creative gap and the need for guided, responsible storytelling |
| The Product | 6–12 | Demonstrate the beat-based workflow from idea to controllable audiovisual story |
| The Platform | 13–17 | Explain continuity, audiences, business model and defensibility |
| Build With Us | 18–20 | Present go-to-market, roadmap and the collaboration ask |

Claims are deliberately time-bounded. Coins and paid tiers are described as part of the current product system; marketplace economics, creator rewards, multilingual dubbing and interactive story formats are presented as future directions.

## Asset use

All eight new supplied images were reviewed, converted to responsive WebP assets and assigned to the part of the narrative they support:

| Supplied asset | Presentation use |
| --- | --- |
| Background 1 | Opening promise: prompt to narrated story world |
| Background 2 | Product system: story beats, characters, narration and export |
| Background 3 | Platform defensibility and the orchestration/rendering pipeline |
| Background 4 | Audience network: parents, educators, creators and communities |
| Four transparent character illustrations | “One engine, many story identities” portfolio |

The original PNG files remain in `Kissago_Learn_Prompt_Pack/assets`. Optimised runtime files live under `public/learn/backgrounds` and `public/learn/illustrations`. Run `node scripts/optimize-learn-assets.mjs` to rebuild them from the source pack.

## Reuse and architecture

| Concern | Reused | Route-scoped implementation |
| --- | --- | --- |
| Identity | `KissagoLogo` | Presentation top bar and closing ask |
| Typography and colour | Global Inter/Playfair variables and neutral/emerald/amber palette | Editorial slide hierarchy and semantic accents |
| Motion | `motion/react` | Active-slide entrances with reduced-motion fallback |
| Routing | Next.js App Router and `next/link` | `/learn`, `/tutorial` redirect and stable hashes |
| Media | `next/image` | Eleven optimised backgrounds, four portrait illustrations and screenshot slots |
| Navigation | Native history and scrolling | Snap viewport, section progress, keyboard, wheel, touch and explicit controls |

Slide content and section ranges live in `lib/learn/content.ts`. Navigation parsing and clamping remain isolated in `lib/learn/navigation.ts`. `LearnExperience` owns presentation state and input handling; `LearnVisual` owns the reusable product and investor-facing compositions.

## Implemented behaviour

- 20 responsive slides with stable `#slide-01` through `#slide-20` links and named section hashes.
- Native horizontal snap, touch swipe, arrow keys, Page Up/Page Down, Home/End and on-screen controls.
- Weighted four-section progress so segment widths match their slide counts.
- Push-state navigation for explicit actions and replace-state synchronisation for native scrolling.
- Optional `?present=1` fullscreen presentation mode with Escape to exit.
- Semantic slide labels, live current-slide announcement, visible focus states and inert off-screen slides.
- Mobile-safe internal scrolling so text and visuals remain readable without scaling the deck down.
- Direct calls to the live product and public story gallery on the final collaboration slide.
- Typed authentic-screenshot slots. Empty slots retain complete code-native product-flow visuals and never imply unavailable product screens.

## Validation

- `npm test`: **57 files and 348 tests passed**.
- `npx tsc --noEmit`: **passed**.
- `npm run lint`: **passed with no errors**. One pre-existing `react-hooks/exhaustive-deps` warning remains in `components/story/AdvancedOptions.tsx:211`.
- `npm run build`: **passed**. `/learn` is statically generated at 17.3 KB route size and 168 KB first-load JavaScript in the validation build.
- Browser review: checked the opening, product-system, character-portfolio, platform-defensibility and closing-partner slides at 1440 × 900, plus the character portfolio at 500 × 900.

Final captures:

- `docs/screenshots/learn-desktop.png`
- `docs/screenshots/learn-mobile.png`

## Screenshot handoff

The pack still contains no privacy-reviewed in-product screenshots. To add approved captures later, place optimised files under `public/learn/screenshots` and register their source, alt text and caption in `LEARN_SCREENSHOT_ASSETS`. The corresponding slides will automatically replace their code-native fallback without changing the presentation structure.
