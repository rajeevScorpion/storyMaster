# 08 — Test Plan and Acceptance Criteria

## Core test areas

### Character library

- [ ] user can view story characters
- [ ] user can save a named character globally
- [ ] global character appears in library
- [ ] saved character retains prompt/reference data
- [ ] editing character metadata does not break existing story usage

### Character scope and instances

- [ ] reusing a global character in a new story creates a local instance
- [ ] local overrides do not mutate the global master unexpectedly
- [ ] characters from different stories can be mixed into a new local story
- [ ] duplicate-name cases are handled safely

### Episodic branching

- [ ] user can continue a story as an episode
- [ ] all named characters auto-migrate into the episode branch
- [ ] story bible is carried forward
- [ ] journal is updated for the new episode
- [ ] next episode generation uses continuity context

### Backward compatibility

- [ ] existing story generation still works
- [ ] Pack 1 beat control still works
- [ ] existing images/narration/options still load
- [ ] export/share/book/reel flows are not broken

### Error and edge cases

- [ ] empty or missing character prompts handled safely
- [ ] deleted/archived characters handled safely
- [ ] partial-migration failures recover gracefully
- [ ] long episodic chains remain usable

## Acceptance criteria

Pack 2 is acceptable only if:

1. named characters can become reusable account-level entities
2. all named characters migrate automatically into a continued episode
3. character reuse in new stories is possible through local instances
4. story bible + journal continuity are operational
5. current Kissago behavior is not broken
6. feature toggles can disable risky new behavior safely
