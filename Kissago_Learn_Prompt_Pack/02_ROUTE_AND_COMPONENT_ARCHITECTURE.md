# Route and Component Architecture

## Route structure

Primary route:

- `/learn`

Compatibility route:

- `/tutorial` → redirect to `/learn`

Optional direct-access conventions:

- `/learn#why`
- `/learn#how`
- `/learn#build`
- `/learn#slide-08`
- `/learn?present=1`

Use the routing style already established in the codebase.

## Recommended page composition

```text
LearnPage
└── LearnShell
    ├── LearnTopBar
    │   ├── Kissago identity / existing navigation
    │   ├── Chapter title
    │   └── Presentation mode control
    ├── ChapterProgress
    ├── HorizontalSlideViewport
    │   ├── LearnSlide x 18
    │   │   ├── SlideHeader
    │   │   ├── SlideNarrative
    │   │   ├── SlideVisual
    │   │   ├── ScreenshotFrame
    │   │   └── ExpandableDetail
    ├── SlideProgress
    └── LearnNavigationControls
```

Adapt names to current project conventions.

## Data-driven slide model

Keep content separate from layout logic.

Suggested shape:

```ts
type LearnSlide = {
  id: string
  chapter: 'why' | 'how' | 'build'
  index: number
  eyebrow?: string
  title: string
  body: string
  supportingPoints?: string[]
  visualType:
    | 'statement'
    | 'tool-fragmentation'
    | 'calm-content'
    | 'story-equation'
    | 'timeline'
    | 'screenshot'
    | 'character-world'
    | 'best-practices'
    | 'use-cases'
    | 'story-universe'
    | 'cta'
  screenshotKey?: string
  assetKey?: string
  expandableDetail?: string
  accent?: 'emerald' | 'ember' | 'balanced'
  cta?: {
    label: string
    href: string
  }
}
```

Reuse established typing, data and content patterns where possible.

## Horizontal navigation behavior

Preferred behavior:

- Native horizontal scrolling with CSS scroll snap
- Programmatic controls for keyboard and explicit next/previous buttons
- Translate vertical wheel intent into horizontal movement only while the slide viewport is active and only where it does not trap normal page navigation
- Preserve native trackpad behavior
- Mobile uses touch swipe
- Avoid a custom drag system if native scrolling already provides the required quality

Do not globally suppress page scrolling.

## Active slide calculation

Use a stable method such as:

- `IntersectionObserver`
- Scroll position and container width
- Existing carousel state utilities

The active slide should update:

- Slide counter
- Chapter indicator
- URL hash or route state
- Progress animation
- Contextual accent treatment

Avoid causing a route re-render for every pixel of scroll.

## Presentation mode

Presentation mode is optional but recommended if it fits cleanly.

Possible behavior:

- Activated with `?present=1` or an explicit control
- Reduces non-essential global chrome
- Enlarges key statements
- Retains previous/next controls
- Keeps keyboard navigation
- Does not force browser fullscreen
- Does not remove accessibility controls
- Exits without losing the current slide

## Expandable details

On mobile, secondary details may collapse.

Rules:

- Main headline and primary explanation remain visible
- Expandable content is genuinely secondary
- Accordions use existing components
- State should be local to the slide
- Do not require several expansions to understand the overall narrative

## Screenshot frame

Use a reusable screenshot/media frame that:

- Matches existing Kissago surface treatment
- Supports desktop and mobile captures
- Has a stable aspect ratio
- Shows a fallback placeholder while assets are missing
- Supports captions
- Uses restrained glow only on emphasis slides
- Does not imitate a generic browser mockup unless browser framing already exists in the product system

## Final actions

The last slide should use actual product routes.

Do not invent routes. Audit the app and map:

- Start Creating
- Explore a Sample Story
- Watch a Guided Demo

If only one or two are currently possible, show only those.
