# Story Map Implementation Log

## Existing Architecture (Before Changes)

- **State**: `StorySession` with flat `beats: StoryBeat[]` array. Current beat = last element.
- **Store**: Zustand with `idb-keyval` persistence. Actions: `startStory`, `continueStory`, `resetStory`.
- **Generation**: Client-side calls to Gemini API via `generateStoryBeat()` and `generateImage()`.
- **UI**: `LandingScreen` (prompt input) → `StoryScreen` (beat display + choices) → loop until ending.
- **Prompts**: `STORY_MASTER_SYSTEM_PROMPT` with general storytelling rules, no age/setting/pacing customization.

## Refactor Plan

### State Model: Flat Array → Story Map Tree

Replace `beats[]` as source of truth with `StoryMap`:
```
StoryMap {
  nodes: Record<string, StoryNode>  // nodeId → node
  rootNodeId: string
  currentNodeId: string
}

StoryNode {
  id, beatNumber, parentId, selectedOptionId, data: StoryBeat, children: string[]
}
```

`beats[]` is now a **computed** linear path from root → current node (for Gemini prompt compatibility).

### Story Customization

New `StoryConfig { ageGroup, settingCountry, maxBeats }` stored in session. Flows through to AI prompt.

### Branching Logic

When user picks an option:
1. Check if child node already exists for that option → instant load (no API call)
2. If not → generate new beat, create child node, link to parent

### Timeline UI

Horizontal timeline showing root-to-current path. Clickable nodes for instant navigation.

## State Model Decisions

- `StoryMap` is the single source of truth for story content
- `beats[]`, `choiceHistory`, `currentBeat`, `characters`, `status` are derived from the map
- `deriveSessionFields()` recomputes all derived fields whenever `storyMap` changes
- Persist migration converts old v0 flat `beats[]` to linear `StoryMap` chain

## Persistence Decisions

- Continue using `idb-keyval` via Zustand persist middleware
- Bumped persist version to 2 with migration function
- Added `partialize` to exclude transient state (`isLoading`, `loadingClues`, `error`)
- Migration wrapped in try/catch — falls back to fresh session on failure

## Prompt Updates

Added to `STORY_MASTER_SYSTEM_PROMPT`:
- **Age adaptation rules**: 6 age groups with specific language/tone guidance
- **Setting adaptation rules**: culturally appropriate content when setting specified
- **Beat pacing rules**: strict enforcement of `maxBeats` (must end exactly on that beat)

`generateStoryBeat` now injects a `Story Configuration` block into the prompt with age group, setting, maxBeats, and current beat position. `storyMap` and `storyConfig` are stripped from the session state sent to Gemini.

## Files Changed

| File | Change Type |
|---|---|
| `lib/types/story.ts` | Modified — added `AgeGroup`, `StoryConfig`, `StoryNode`, `StoryMap`; updated `StorySession` |
| `lib/utils/story-map.ts` | **New** — tree utility functions (`createStoryMap`, `addChildNode`, `findChildForOption`, `getPathToNode`, etc.) |
| `lib/store/story-store.ts` | Modified — refactored to StoryMap, added `navigateToNode`, branch reuse, migration, `partialize` |
| `lib/ai/prompts.ts` | Modified — added age/setting/pacing rules to system prompt |
| `app/actions/story.ts` | Modified — injects StoryConfig into prompt, strips storyMap from sent state |
| `components/story/AdvancedOptions.tsx` | **New** — config form (age group dropdown, setting dropdown + custom, story length slider) |
| `components/story/Timeline.tsx` | **New** — horizontal timeline with clickable nodes and branch indicators |
| `components/story/LandingScreen.tsx` | Modified — added Advanced Options toggle with config state |
| `components/story/StoryScreen.tsx` | Modified — uses storyMap for current beat, renders Timeline, shows explored branch indicators on options |

## Completed Tasks

- [x] Add new types (`AgeGroup`, `StoryConfig`, `StoryNode`, `StoryMap`)
- [x] Create story map utility functions
- [x] Refactor Zustand store to StoryMap architecture
- [x] Add branch reuse logic (check existing children before generating)
- [x] Add `navigateToNode` for instant timeline navigation
- [x] Add persist migration (v0 → v2)
- [x] Update AI prompt with age/setting/pacing rules
- [x] Inject StoryConfig into generation prompt
- [x] Create AdvancedOptions component
- [x] Update LandingScreen with advanced options toggle
- [x] Create Timeline component
- [x] Update StoryScreen with timeline and storyMap navigation

## Pending Tasks

- [ ] Build verification
- [ ] Runtime testing of all user journeys

## Known Issues

- Base64 image URLs stored in nodes can make the storyMap large. For now this is acceptable since `idb-keyval` handles large values well. Future optimization: store images separately.
- Mock mode returns hardcoded `imagePrompt` containing "Cinematic children's storybook illustration" which triggers the placeholder path in `generateImage`. This is by design for testing without API calls.

## Test Scenarios

### A. Story Customization
- Start story with defaults → works same as before
- Start with each age group → verify language adaptation
- Start with setting → verify cultural context
- Start with maxBeats 3-8 → verify story ends on correct beat

### B. Timeline Navigation
- Generate 3+ beats → timeline shows connected nodes
- Click earlier node → instant load, no API call
- Navigate forward through explored branch → instant load

### C. Branch Reuse
- Choose option A from beat 2 → generates 3A
- Navigate back to beat 2, choose A again → loads 3A instantly

### D. New Branching
- Navigate back to beat 2, choose option B → generates new 3B
- Beat 3A still accessible

### E. Persistence
- Refresh after exploring branches → state restores correctly
- Current node preserved, branches intact

### F. Failure Handling
- Corrupted IndexedDB → app falls back to fresh session

## Summary

The app has been refactored from a linear beat array to a branching tree architecture (`StoryMap`). Users can now:
1. Customize stories with age group, setting, and length before starting
2. Navigate back through the timeline to any previously visited beat
3. Branch from any past beat by choosing a different option
4. Revisit previously explored branches instantly (no regeneration)
5. Have the full explored story graph persisted and restored across refreshes
