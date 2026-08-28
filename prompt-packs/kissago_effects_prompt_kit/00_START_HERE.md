# Kissago Story Effects - Prompt Kit for AI Coder

## Objective
Add a **story-effects system** to Kissago so still-image story panels feel more alive during playback.

The feature must support:
- beat-specific effects
- one-click **apply to all beats in the story**
- reusable **presets** that can be saved and applied to other stories
- user-controlled settings such as:
  - particle amount
  - visibility / opacity
  - density
  - speed
  - size / scale
  - direction
  - depth / parallax strength
  - intensity
  - transition duration
- exported videos must include the same effects

## Non-negotiable implementation instructions
The AI coder must:
1. **Not assume anything**.
2. **Ground every decision in the actual codebase**.
3. Ask **clarifying questions before making structural decisions**.
4. Prefer **practical and maintainable** solutions over theoretically perfect but heavy ones.
5. Create a **new branch** before implementation.
6. Commit after meaningful milestones with clear commit messages.
7. Avoid breaking any currently working playback, narration sync, overlay text sync, transitions, or exports.

## Recommended reading order
1. `01_MASTER_PROMPT.md`
2. `02_PRODUCT_GOALS_AND_SCOPE.md`
3. `03_LIBRARY_RESEARCH.md`
4. `04_RECOMMENDED_ARCHITECTURE.md`
5. `05_EFFECT_CATALOG.md`
6. `06_DATA_MODEL_AND_PRESETS.md`
7. `07_IMPLEMENTATION_PLAN.md`
8. `08_ACCEPTANCE_CRITERIA.md`
9. `09_TEST_PLAN.md`
10. `10_CLARIFYING_QUESTIONS.md`

## Deliverable expectation from coder
The coder should return:
- discovery findings grounded in the repository
- a proposed implementation approach
- a list of clarifying questions
- a phased implementation plan
- final implementation with tests and documentation

