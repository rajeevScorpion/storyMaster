# 04 — UX and User Flows

Pack 2 should feel simple even if the underlying continuity system is deep.

## User-facing sections

### 1. Character Library

Suggested tabs:

- Current Story Characters
- Episode Characters
- My Characters

Possible actions:

- view character card
- save globally
- edit metadata
- select for story use
- archive/hide

### 2. End-of-story continuation

At the end beat or story end state, provide a clear action such as:

- Continue as Episode
- Start Next Adventure
- Create Episode from this Storyline

When selected, the system should automatically:

- create or attach to an episode branch
- migrate all named characters
- carry story bible and journal context
- prefill continuity context for the next episode generation

### 3. New story with selected characters

When starting a new story, the user may optionally open a character picker and bring in selected saved characters.

Behavior:

- selected characters become local story instances
- original source characters remain intact
- local overrides are allowed

## Simple UX principles

- Do not expose complex scope terms too early.
- The system may show friendly labels like:
  - This Story
  - This Series
  - My Library
- Advanced details can be shown in expandable sections.
- If automatic migration happens, show a lightweight confirmation, not a heavy setup wizard.

## Example flow — continue as episode

1. User finishes a story.
2. User clicks “Continue as Episode”.
3. System creates/updates episode branch.
4. System carries story bible + journal summary.
5. System migrates all named characters.
6. User sees a prefilled episode-start screen.
7. New story generation uses carried continuity context.

## Example flow — mix characters

1. User starts a new story.
2. User opens Character Library.
3. User selects Tara from Story A and Milo from Story B.
4. System creates local story instances for Tara and Milo.
5. User generates story.
6. New story uses those characters locally without altering original source stories.
