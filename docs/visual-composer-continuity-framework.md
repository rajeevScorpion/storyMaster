# Kisago Visual Composer — Continuity, Temporal Evolution & Cinematic Storytelling Framework

## Purpose

This document defines a **generic, story-agnostic system-level framework** for Kisago’s visual image composer.

Its purpose is to prevent a common failure mode in sequential image generation:

> **continuity being interpreted as sameness.**

The visual composer must preserve narrative coherence and character identity without freezing clothing, hairstyle, age cues, environments, props, staging, or camera language when the story itself requires those elements to evolve.

This framework should apply equally to all future stories, regardless of character names, genres, age groups, settings, or visual styles.

The goal is not to hard-code a particular story. The goal is to add reusable reasoning scaffolding so the composer can determine:

- what must remain visually consistent,
- what should evolve,
- what can be creatively reinterpreted,
- what must change because of time or context,
- what should persist because of causal continuity,
- and how cinematography should progress without becoming repetitive.

---

# 1. Core Problem

A generic continuity instruction such as:

> “Preserve character identity, clothing and colours throughout.”

works only when all panels depict moments from the **same short continuous scene**.

It becomes harmful when the story contains:

- time jumps,
- ageing,
- location changes,
- emotional transformation,
- changes in role or relationship,
- seasonal changes,
- different activities,
- flashbacks,
- memories,
- dreams,
- new environments,
- or multiple life stages.

In those cases, overly literal continuity can cause:

- children to appear as enlarged adults wearing the same clothes,
- hairstyles to remain unchanged over many years,
- signature accessories to become permanent costume,
- different locations to look like the same place,
- environments to remain frozen despite time jumps,
- emotional development to be visually flattened,
- repeated framing and camera placement across panels,
- identical blocking even when relationship dynamics have changed,
- props to persist after their narrative purpose has ended,
- and reference images to overpower current story context.

The system therefore needs a more precise continuity model.

---

# 2. Guiding Principle

The visual composer must distinguish **identity continuity** from **surface continuity**.

## Primary rule

> **Preserve narrative truth, not every visible attribute.**

## Cinematic rule

> **Every frame should inherit only what the story requires and reinterpret everything else in service of the current dramatic beat.**

This means:

- identity may need to remain stable,
- age may need to evolve,
- clothing may or may not remain stable,
- hairstyle may evolve,
- props may need strict causal continuity,
- environment may remain or change,
- camera treatment should usually be free to evolve,
- and emotional posture should follow character development rather than visual reference inertia.

---

# 3. Continuity Must Be Attribute-Specific

Do not use one undifferentiated “maintain continuity” rule.

Every meaningful visual attribute should be classified independently using three states:

| State | Meaning |
|---|---|
| `LOCKED` | Must remain consistent unless the story explicitly changes it |
| `EVOLVE` | Must remain recognizable or related, but should naturally change according to time, context, age, activity, or narrative progression |
| `FREE` | The composer has creative freedom and should optimize for cinematic storytelling and plausibility |

This tri-state model should become the foundation of the visual composer.

---

# 4. Recommended Continuity Taxonomy

The system should reason separately about each of the following dimensions.

| Dimension | Typical default | Literal continuity should dominate when | Evolution / freedom should dominate when |
|---|---|---|---|
| Character identity | `LOCKED` | Always, unless transformation is explicitly part of story | Never casually redesign identity |
| Facial structure | `LOCKED` / `EVOLVE` | Same time period | Ageing, injury, illness, transformation |
| Age | Story-driven | Same chronological period | Explicit or inferred time jump |
| Body proportions | `EVOLVE` | Same age/session | Child → teen → adult, ageing |
| Hairstyle | `EVOLVE` | Same continuous scene | Time jump, lifestyle change, different context |
| Clothing | Context-driven | Same scene/session | New day, age, activity, location, role |
| Signature accessory | `LOCKED` or `EVOLVE` | If plot-critical | If only an identity motif |
| Environment | Scene-driven | Same physical place | New location, time jump, new social context |
| Architecture | Scene-driven | Same location | Different venue or era |
| Props | Causally `LOCKED` | While active in same action chain | After narrative purpose ends |
| Injuries / wetness / dirt | Causally `LOCKED` | Immediate continuation | After elapsed time/reset |
| Lighting | `FREE` within logic | Continuous minutes | Different time/weather/location |
| Colour palette | Soft continuity | Shared sequence | Emotional / temporal shift |
| Camera position | Usually `FREE` | Deliberate match cut or spatial continuity | Most panel transitions |
| Lens / framing | `FREE` | Intentional repetition | Use dramatic function |
| Character blocking | Causally constrained | Immediate action continuity | New beat or new place |
| Emotional state | `EVOLVE` | Same emotional beat | Narrative progression |
| Relationship distance | `EVOLVE` | Immediate moment | Trust, conflict, intimacy, power changes |
| Art style | `LOCKED` | Storyboard/story | Only explicit style transition |
| World design language | `LOCKED` | Same universe | Specific locations can still differ |

---

# 5. The Composer Needs a Structured Story State

The image model should not be expected to infer all continuity logic directly from prose.

Before prompt generation, create a structured **Visual Story State** for every panel.

A recommended internal representation:

```yaml
panel_id:
story_time:
time_since_previous_panel:
time_jump_class:

location:
same_location_as_previous:
environment_type:
environment_state:
weather:
time_of_day:

characters_present:
  - character_id:
    identity_state:
    age:
    life_stage:
    facial_state:
    body_state:
    hairstyle_state:
    wardrobe_state:
    accessories:
    physical_state:
    emotional_state:
    relationship_state:
    current_action:
    screen_position:
    continuity:
      identity: LOCKED
      face: LOCKED
      age: EVOLVE
      hair: EVOLVE
      wardrobe: FREE

props_present:
  - prop_id:
    state:
    causal_importance:
    continuity_mode:

story_function:
visual_priority:
dramatic_question:
camera_intent:
shot_scale:
camera_height:
camera_position:
viewing_axis:
subject_orientation:
foreground_strategy:
background_strategy:
depth_strategy:

continuity_locks:
continuity_evolutions:
creative_freedoms:
must_not_inherit:
```

The final natural-language image prompt should be compiled from this structured state.

---

# 6. Story Time Must Be Explicit

The composer should calculate the temporal relationship between consecutive panels.

Recommended transition classes:

| Time relationship | Continuity behaviour |
|---|---|
| Seconds/minutes later | Strong physical, wardrobe, environment, prop, and body-state continuity |
| Same session | Strong continuity with modest camera freedom |
| Hours later | Character identity locked; lighting and staging may evolve |
| Next day | Identity locked; wardrobe and environment state may change |
| Days/weeks later | Styling may evolve; props may reset; environment may change |
| Months later | Hair, wardrobe, routine, physical state may evolve |
| Years later | Identity locked; age/body/hair/wardrobe/environment should be reconsidered |
| Flashback | New temporal state; visual distinction encouraged |
| Memory | Identity anchors remain; treatment may become interpretive |
| Dream / imagined sequence | Story facts remain; visual world may become freer |

### Important implementation rule

A large time jump should automatically invalidate surface-level continuity unless the story explicitly reasserts it.

The system should reason:

```text
Same person?                     Preserve.
Same age?                        Recompute.
Same hairstyle?                  Recompute.
Same clothing?                   Recompute.
Same location?                   Recompute.
Same prop?                       Only if story says so.
Same emotional relationship?     Evolve.
Same camera language?            No reason to preserve.
Same art style?                  Preserve unless instructed otherwise.
```

---

# 7. Character Identity Must Be Separated From Appearance State

Each character should have two layers:

## A. Persistent Identity Profile

Used to recognize the same person across scenes and ages.

Possible identity anchors:

- facial geometry,
- eye shape,
- nose and jaw characteristics,
- skin tone,
- recurring expression tendencies,
- family resemblance,
- posture tendencies,
- highly distinctive physical markers,
- signature motif where narratively useful.

## B. Current Appearance State

Recomputed for the current panel or scene:

- age,
- life stage,
- body proportions,
- hairstyle,
- grooming,
- clothing,
- accessories,
- posture,
- confidence,
- fatigue,
- injury,
- wetness,
- occupation/context cues.

### Key rule

Do not use clothing as the primary character identity anchor unless the story explicitly requires a uniform or iconic costume.

The system should avoid learning:

> “same shirt + same hairstyle = same character.”

Instead it should preserve the person while allowing the presentation to evolve.

---

# 8. Signature Motifs Must Be Soft, Not Literal

Recurring visual motifs are useful for helping viewers recognize a character across time.

Examples:

- a colour family,
- a hair accessory,
- a bracelet,
- a pattern,
- a distinctive shape,
- a preferred garment colour,
- a recurring object.

But the composer should distinguish:

```text
identity motif
```

from:

```text
mandatory unchanged object
```

A motif can transform with age and context.

Example logic:

```text
earlier life stage:
bright, obvious motif

later life stage:
subtle, age-appropriate reinterpretation
```

The purpose is visual memory, not costume cloning.

---

# 9. Wardrobe Requires Its Own Reasoning Pass

Wardrobe should be derived from:

```text
age
+ life stage
+ location
+ activity
+ climate
+ culture
+ personality
+ social role
+ story time
+ emotional context
```

It should not be inherited from a previous panel simply because the previous image used it.

## Strong wardrobe continuity

Use when:

- panels occur minutes apart,
- characters are in the same event/session,
- there has been no clothing-change opportunity,
- a uniform/costume is plot-relevant.

## Weak wardrobe continuity

Use when:

- a new day starts,
- a time jump occurs,
- the character moves to another location,
- the character enters another life stage,
- activity changes,
- social context changes,
- the story says “years later,”
- the character has undergone meaningful development.

### Recommended visual strategy

When useful, preserve **colour-family echoes** rather than exact garments.

This creates cohesion without implausible sameness.

---

# 10. Environment Continuity Must Also Be Classified

A recurring narrative concept does not imply the same physical environment.

For example:

```text
same activity category ≠ same location
same emotional theme ≠ same architecture
same city ≠ same room
same type of pool ≠ same pool
```

The composer should explicitly know:

```yaml
location_relation:
  SAME_EXACT_LOCATION
  SAME_BUILDING_DIFFERENT_AREA
  SAME_CATEGORY_DIFFERENT_LOCATION
  NEW_LOCATION
  UNKNOWN
```

For a new location, inherited visual details should be actively suppressed.

The system should vary, where appropriate:

- architecture,
- materials,
- landscaping,
- furniture,
- signage style,
- lighting,
- spatial scale,
- background population,
- weather,
- colour temperature,
- decor,
- cultural cues.

---

# 11. Detect Narrative Discontinuities Before Prompting

The system should scan narration for discontinuity signals.

Examples include:

### Temporal
- years later
- months later
- next summer
- the next day
- when they were older
- after graduation
- in adulthood
- later in life

### Spatial
- another city
- at a resort
- at school
- at home
- in hospital
- in a new apartment
- on vacation

### Life-stage
- child → adolescent
- student → professional
- parenthood
- retirement
- physical ageing

### Emotional
- reconciliation
- loss of trust
- new confidence
- fear becoming competence

### Structural
- flashback
- dream
- memory
- imagined sequence
- montage
- epilogue

Whenever such signals are detected, inherited attributes must be reconsidered rather than blindly carried forward.

---

# 12. Causal Continuity Must Be Strong

Creative freedom should never break physical cause-and-effect.

For immediately sequential panels:

- the same active prop should persist,
- injuries should persist,
- wet clothing should remain wet,
- a held object should not teleport,
- a door opened in one panel should not be closed without cause,
- the same rescue tool should not change shape or colour,
- spatial relations should remain plausible,
- action direction should remain understandable,
- characters should not randomly switch sides unless motivated,
- the environment should remain spatially coherent.

This is **causal continuity** and should generally be stronger than decorative continuity.

### Important distinction

```text
Narrative continuity = essential
Surface continuity   = conditional
```

---

# 13. Add Visual State Deltas Between Panels

For each transition, compute:

```text
WHAT REMAINS
WHAT CHANGES
WHAT IS NEW
WHAT DISAPPEARS
```

Example generic structure:

```yaml
transition_delta:
  remains:
    - character identity
    - relationship history
    - active object

  changes:
    - age
    - clothing
    - hairstyle
    - emotional posture

  new:
    - new location
    - new character
    - new prop

  disappears:
    - obsolete prop
    - previous environment
    - temporary injury state
```

This is one of the most important pieces of scaffolding.

It prevents the prompt compiler from treating the previous panel as a complete template for the next one.

---

# 14. Introduce `must_not_inherit`

In addition to describing what should continue, the system should explicitly identify what **should not be inherited**.

Example:

```yaml
must_not_inherit:
  - previous wardrobe
  - previous hairstyle
  - previous environment architecture
  - previous pose
  - previous camera position
```

This is particularly useful for:

- large time jumps,
- location changes,
- age changes,
- dream sequences,
- montage structures,
- new chapters.

This helps counteract the natural anchoring tendency of generative image systems.

---

# 15. Continuity Strength Can Be Represented Internally

The system may benefit from internal weights such as:

```yaml
continuity_strength:
  identity: 1.0
  facial_structure: 0.95
  hairstyle: 0.25
  wardrobe: 0.1
  environment: 0.0
  props: contextual
  emotional_theme: 0.8
  camera_position: 0.0
  art_style: 1.0
```

These values do not necessarily need to be passed numerically to the image model.

They can guide the prompt composer and validation layer.

---

# 16. The Composer Must Distinguish Story Facts From Visual Interpretation

Every panel should contain two different classes of information.

## Story Facts

These cannot be contradicted.

Examples:

- age,
- location,
- who is present,
- who is absent,
- action outcome,
- required prop,
- injury,
- relationship,
- time period,
- causal sequence.

## Visual Interpretation

These can be decided creatively:

- precise camera placement,
- shot scale,
- lens feeling,
- composition,
- foreground obstruction,
- lighting mood,
- negative space,
- gesture subtlety,
- exact hairstyle design within continuity constraints,
- exact wardrobe design within story constraints,
- background detail,
- staging.

This separation enables controlled creative freedom.

---

# 17. Constraint Priority

Not all instructions should have equal weight.

Recommended priority hierarchy:

| Priority | Constraint |
|---|---|
| P0 | Safety and content policy |
| P1 | Story truth |
| P2 | Character identity |
| P3 | Temporal and causal continuity |
| P4 | Required action |
| P5 | Character presence / absence |
| P6 | Cinematic intention |
| P7 | Environment logic |
| P8 | Wardrobe / styling |
| P9 | Decorative motifs |
| P10 | Optional aesthetic interpretation |

A minor motif must never override a major time jump.

---

# 18. Cinematography Must Be Decoupled From Continuity

Character continuity does not require camera continuity.

The image composer should not reuse the same camera setup simply because the same characters or environment appear.

Shot descriptions such as:

```text
wide
medium
close-up
cinematic payoff
```

are not sufficient by themselves.

The system should also define:

- camera height,
- camera side,
- viewing axis,
- lens feeling,
- foreground relationship,
- depth,
- character orientation,
- screen direction,
- negative space,
- spatial tension,
- dominant geometry,
- visual hierarchy.

---

# 19. Camera Choice Must Follow Dramatic Function

Instead of selecting shot scale mechanically, first determine:

> What does the audience need to feel or understand in this beat?

Possible story functions:

```text
ESTABLISH
REVEAL
ESCALATE
HESITATE
REACT
CHOOSE
ACT
TRANSFORM
CONNECT
ISOLATE
RESOLVE
FORESHADOW
CONTRAST
```

Then derive camera treatment from that purpose.

Example reasoning:

```text
Story function: HESITATE
Emotional function: vulnerability
Camera implication:
- lower perspective
- environment visually dominant
- character slightly off-centre
- increased negative space
```

Another:

```text
Story function: CHOOSE
Emotional function: agency
Camera implication:
- clear body orientation
- relationship geometry visible
- less environmental dominance
- stronger forward direction
```

---

# 20. Add a Shot Diversity Check

Across a multi-panel storyboard, evaluate:

- shot scale,
- camera height,
- viewing direction,
- character orientation,
- subject placement,
- foreground strategy,
- depth,
- dominant geometry,
- number of visible characters,
- background density,
- movement direction.

If several panels are too similar, revise the cinematic plan before generation.

### Important

The goal is **not random variation**.

It is:

> **motivated visual variation.**

Variation should communicate changes in:

- power,
- urgency,
- vulnerability,
- scale,
- trust,
- distance,
- agency,
- intimacy,
- revelation.

---

# 21. Repetition Can Be Intentional

Repeated framing is not always bad.

A deliberate visual echo can be powerful.

Examples:

- same composition at two different ages,
- same doorway years apart,
- same family table before and after a major event,
- same location with radically changed relationships.

But the system should tag this deliberately:

```yaml
shot_relationship: DELIBERATE_VISUAL_ECHO
```

Otherwise repeated composition should be treated as a potential failure.

The distinction is:

```text
intentional repetition
vs.
accidental repetition
```

---

# 22. Relationship Geometry Should Evolve

Characters should not always occupy the same spatial relationship.

The composer should consider:

- who stands closer,
- who leads,
- who follows,
- who touches whom,
- who waits,
- who occupies foreground,
- who occupies background,
- who has open or closed posture,
- how much negative space exists between characters.

Relationship development can be visualized through blocking.

This is especially important in stories about:

- trust,
- fear,
- reconciliation,
- independence,
- mentorship,
- conflict,
- parent-child evolution,
- friendship,
- romance,
- grief.

---

# 23. Emotional Continuity Is Not Emotional Sameness

Characters may carry emotional history while still changing beat to beat.

Example progression:

```text
fear
→ controlled fear
→ hesitation
→ decision
→ action
→ relief
```

The composer should visually express this through:

- posture,
- shoulders,
- eye direction,
- hand tension,
- breathing,
- distance,
- facial tension,
- movement,
- framing.

Do not simply repeat the same “worried face” because the story theme remains fear.

---

# 24. Each Panel Needs One Primary Visual Job

Every panel should receive a single dominant visual function.

The composer should be able to answer:

> What must the viewer understand from this image even without narration?

A panel description should not merely reproduce the prose.

It should translate the narrative beat into a visual objective.

Recommended fields:

```yaml
story_function:
audience_takeaway:
emotional_shift:
visual_priority:
```

Example:

```yaml
story_function: CHOOSE
audience_takeaway: The character is afraid but is acting by choice.
emotional_shift: fear -> agency
visual_priority: body language and forward motion
```

---

# 25. Storyboard-Level Rhythm

The four panels should be evaluated as a sequence.

The system should look for progression in:

- scale,
- density,
- movement,
- depth,
- subject dominance,
- visual tension,
- emotional intensity,
- spatial distance,
- directional flow.

A visually coherent storyboard should not feel like four independently posed illustrations.

It should feel like a progression.

---

# 26. Recommended Panel Prompt Architecture

Each panel prompt should be compiled from six explicit layers.

## A. Story Function

Why does this frame exist?

## B. Required Story Facts

Facts the image cannot contradict.

## C. Continuity Anchors

What must match previous panels?

## D. Expected Evolution

What should visibly change from previous states?

## E. Cinematic Interpretation

How should the frame communicate the beat?

## F. Creative Freedom

What is safe for the composer to reinterpret?

Only after these layers should rendering style and negative constraints be appended.

---

# 27. Recommended Global Storyboard Prompt Architecture

The full image prompt should roughly follow this order:

```text
1. OUTPUT FORMAT
2. STORYBOARD READING ORDER
3. GLOBAL VISUAL STYLE
4. CHARACTER IDENTITY ANCHORS
5. CURRENT LIFE-STAGE STATES
6. TEMPORAL / LOCATION STRUCTURE
7. PANEL-BY-PANEL STORY STATES
8. PANEL-BY-PANEL CINEMATIC INTENT
9. CONTINUITY LOCKS
10. REQUIRED EVOLUTIONS
11. CREATIVE FREEDOMS
12. MUST-NOT-INHERIT RULES
13. NEGATIVE CONSTRAINTS
14. FINAL VALIDATION REMINDER
```

Do not place all information at the same semantic level.

---

# 28. Replace the Existing Generic Continuity Instruction

Avoid:

> Preserve character identity, clothing and colours throughout.

Use a rule conceptually like:

> Preserve character identity and story-world coherence throughout. Maintain literal continuity for consecutive moments occurring within the same scene, including clothing, active props, environment and physical state. When time, age, location, activity or life stage changes, allow appearance, hairstyle, wardrobe, environment and body language to evolve naturally while retaining enough identity anchors for the character to remain unmistakably the same person. Treat recurring colours and accessories as optional visual motifs rather than mandatory unchanged objects unless explicitly required by the story.

---

# 29. Add a Creative Freedom Clause

The system-level composer instruction should include:

> Do not preserve an attribute solely because it appeared previously. Preserve it only when temporal, causal, spatial, identity or narrative logic requires continuity.

And:

> When continuity does not require sameness, favour believable evolution and stronger cinematic storytelling.

And:

> Camera position, staging, framing and environmental composition should not be inherited by default.

---

# 30. Reference Image Handling

Reference images are valuable for identity consistency but can unintentionally freeze:

- wardrobe,
- hairstyle,
- age,
- pose,
- environment,
- lighting,
- body language.

Reference usage should therefore be controlled by continuity state.

For a major time jump, use previous images primarily as:

```text
identity reference
```

while explicitly suppressing:

```text
wardrobe reference
hairstyle reference
age reference
pose reference
environment reference
camera reference
```

If the image API supports:

- masks,
- region references,
- weighting,
- multiple reference strengths,
- identity embeddings,
- character embeddings,

use those capabilities selectively.

If not, compensate in text prompting and pre-generation state resolution.

---

# 31. Contradiction Detection

Before generating an image prompt, the system should detect contradictions such as:

```text
large time jump
+
same wardrobe throughout
```

or:

```text
new location
+
preserve environment
```

or:

```text
adult life stage
+
preserve child hairstyle and proportions
```

or:

```text
character explicitly absent
+
global character list causes inclusion
```

The prompt compiler should resolve contradictions before generation.

---

# 32. Character Presence / Absence Must Be Explicit

A common failure in multi-panel generation is character leakage across panels.

Every panel should explicitly include:

```yaml
characters_present:
characters_absent:
```

The global character list should not imply that every named character must appear in every panel.

Panel-level presence always overrides global story presence.

---

# 33. Prop Lifecycle Tracking

Props should have states.

Example:

```yaml
prop:
  id:
  introduced_panel:
  active:
  held_by:
  position:
  condition:
  removed_panel:
```

This is useful for:

- rescue tools,
- toys,
- weapons,
- bags,
- phones,
- vehicles,
- documents,
- gifts,
- keys,
- food,
- clothing items,
- sports objects.

A prop should not randomly disappear while still causally relevant.

It should also not remain forever after the narrative moves on.

---

# 34. Physical State Tracking

Characters may temporarily have states such as:

- wet,
- muddy,
- injured,
- crying,
- sweating,
- wearing a bandage,
- holding an object,
- carrying another person,
- tired,
- dirty clothes.

These states should persist only as long as story logic requires.

Use:

```yaml
physical_state:
  wetness:
  injury:
  dirt:
  fatigue:
  temporary_markers:
```

---

# 35. Environmental State Tracking

Same location does not mean identical frame.

The environment can evolve through:

- time of day,
- weather,
- crowd level,
- lighting,
- activity,
- furniture placement,
- seasonal cues,
- damage,
- decorations.

The system should distinguish:

```text
same location
```

from:

```text
same visual composition
```

They are not the same.

---

# 36. Narrative Realism, Not Photorealism

“More realistic” should not be interpreted as “photorealistic.”

A story may remain:

- ink-wash,
- anime,
- stylized illustration,
- painterly,
- graphic novel,
- clay,
- 3D,
- collage.

Narrative realism means:

- people age plausibly,
- clothes match age/context,
- environments change logically,
- causal props persist,
- emotions affect posture,
- relationships affect distance,
- time jumps visibly register,
- camera placement supports meaning.

---

# 37. Recommended Composer Pipeline

The AI coder should inspect the existing Kisago pipeline and map these concepts to current modules rather than replacing working architecture blindly.

Recommended logical flow:

```text
Narrative
   ↓
Narrative Beat Segmentation
   ↓
Story State Extraction
   ↓
Temporal / Spatial Transition Analysis
   ↓
Continuity Classification
   ↓
Character Evolution Pass
   ↓
Wardrobe / Appearance Pass
   ↓
Environment Evolution Pass
   ↓
Causal Continuity Pass
   ↓
Visual State Delta
   ↓
Cinematic Planner
   ↓
Shot Diversity Check
   ↓
Prompt Compiler
   ↓
Prompt Contradiction Validator
   ↓
Image Generation
   ↓
Optional Vision Evaluation
   ↓
Regeneration / Acceptance
```

The coder should preserve existing interfaces where practical.

---

# 38. Suggested Internal Interfaces

The exact implementation may differ depending on the current codebase, but conceptually the following separation is recommended.

## `extractStoryState()`

Outputs:

- time,
- location,
- characters,
- age,
- current appearance,
- emotional state,
- active props,
- required actions.

## `analyzeTransition(previousState, currentState)`

Outputs:

- elapsed time,
- location relationship,
- life-stage change,
- causal continuation,
- discontinuities.

## `classifyContinuity(attribute, transition)`

Outputs:

```text
LOCKED
EVOLVE
FREE
```

## `buildVisualDelta(previousState, currentState)`

Outputs:

```text
remains
changes
new
disappears
must_not_inherit
```

## `planCinematography(beat, surroundingBeats)`

Outputs:

- story function,
- camera intent,
- shot scale,
- camera height,
- axis,
- foreground,
- depth,
- relationship geometry.

## `validateStoryboardPlan()`

Checks:

- repeated camera setups,
- contradictions,
- temporal inconsistency,
- presence leakage,
- wardrobe freezing,
- environment freezing.

## `compileImagePrompt()`

Converts structured state into model-specific natural language.

---

# 39. Model-Agnostic Prompt Compiler

The internal system should remain model-agnostic.

Do not hard-code logic for one image vendor.

Instead:

```text
Narrative Understanding
       ↓
Visual State
       ↓
Continuity Decisions
       ↓
Cinematic Plan
       ↓
Canonical Prompt Representation
       ↓
Model Adapter
```

Each image model adapter may translate the canonical prompt differently.

This makes future fallback image models easier to support.

---

# 40. Pre-Generation Validation Checklist

Before a storyboard prompt is submitted, validate:

## Temporal

- Are ages correct?
- Does ageing match elapsed time?
- Has clothing been reconsidered after a major jump?
- Has hairstyle been reconsidered?
- Has body proportion changed where necessary?

## Environment

- Is this actually the same location?
- If not, has old architecture been excluded?
- Does the new place visually communicate a new context?

## Character

- Are identities preserved?
- Are present / absent characters correct?
- Are age-appropriate design changes present?
- Are motif elements treated appropriately?

## Causal

- Are active props consistent?
- Are physical states consistent?
- Is action direction plausible?

## Cinematic

- Do panels have distinct visual jobs?
- Are camera setups meaningfully varied?
- Is repeated framing deliberate?
- Is the composition serving emotion?

## Prompt

- Are there conflicting instructions?
- Is any low-priority detail overriding story truth?
- Is the negative prompt accidentally preventing required evolution?

---

# 41. Optional Post-Generation Vision Evaluation

If cost and latency allow, generated storyboards can be checked with a vision-capable evaluator.

The evaluator should ask:

### Identity
- Are recurring characters recognizably the same people?

### Temporal evolution
- Do characters visibly age where required?
- Does wardrobe evolve appropriately?
- Does hairstyle evolve appropriately?

### Environment
- Are different locations visually distinct?
- Is the same location coherent when required?

### Causal continuity
- Are props consistent?
- Are physical states consistent?
- Are characters logically positioned?

### Cinematic storytelling
- Does each panel communicate a distinct beat?
- Are camera angles overly repetitive?
- Does the visual sequence progress?

### Presence
- Are required characters present?
- Are explicitly absent characters absent?

### Format
- Correct number of panels?
- Correct grid?
- No extra panels?
- No unwanted text?

The evaluator should return structured failure reasons.

Regeneration should target failed dimensions rather than blindly rewriting the entire prompt.

---

# 42. Suggested Validation Output

Example:

```json
{
  "status": "revise",
  "failures": [
    {
      "type": "temporal_evolution",
      "panel": 4,
      "reason": "Wardrobe appears unchanged despite a major time jump."
    },
    {
      "type": "camera_repetition",
      "panels": [1, 2, 4],
      "reason": "All use nearly identical eye-level three-quarter framing."
    }
  ]
}
```

---

# 43. Important Non-Goals

This system should NOT:

- force random wardrobe changes,
- force random camera angles,
- eliminate recurring visual motifs,
- destroy spatial continuity,
- redesign characters every panel,
- overcomplicate short simple scenes,
- create unnecessary differences in the same moment,
- make cinematic decisions that contradict narration.

The aim is **context-sensitive continuity**.

---

# 44. Decision Heuristics

## When continuity should be literal

Use strong literal continuity when:

- panels are seconds or minutes apart,
- characters remain in the same scene,
- no wardrobe change is possible,
- an action continues directly,
- a prop remains active,
- an injury or physical condition persists,
- the same room/location is still being depicted,
- the narrative explicitly calls for the same appearance,
- an iconic uniform or costume is plot-critical.

## When continuity should evolve

Allow or encourage evolution when:

- years pass,
- life stage changes,
- location changes,
- activity changes,
- social role changes,
- season changes,
- hairstyle is not plot-critical,
- wardrobe is not plot-critical,
- environment is different,
- emotional posture has changed,
- relationship dynamics have changed.

## When creative freedom should be broad

Give the composer more freedom for:

- camera position,
- framing,
- lens character,
- foreground composition,
- negative space,
- depth,
- gesture refinement,
- environment detail,
- lighting within story logic,
- visual metaphor,
- motif reinterpretation.

---

# 45. Suggested System-Level Continuity Rule

The following is suitable as a baseline system instruction for the visual composer:

> Maintain continuity at the level required by story logic, not by literal visual repetition. Preserve character identity, causal actions, active props, physical state and exact environment when consecutive panels belong to the same uninterrupted scene. When the narrative introduces elapsed time, ageing, a new life stage, a new day, a new activity, a new location or a meaningful emotional transition, reassess hairstyle, clothing, body language, environment and other surface attributes instead of inheriting them automatically. Recurring colours or accessories may function as soft identity motifs but should not become mandatory unchanged costume unless narratively required. Camera position, framing and staging should be chosen for the dramatic purpose of each panel and should not be inherited by default.

---

# 46. Suggested System-Level Cinematic Rule

> Treat the storyboard as a visual sequence rather than a set of independent illustrations. Assign each panel a clear dramatic function, then derive camera placement, shot scale, depth, subject orientation, negative space and relationship geometry from that function. Avoid accidental repetition of camera angle, eye level, subject placement or composition. Repetition is acceptable only when intentionally used as a visual echo, match cut or storytelling device.

---

# 47. Suggested Temporal Evolution Rule

> A large time jump should trigger a visual re-evaluation. Preserve identity while allowing age, facial maturity, body proportions, hairstyle, grooming, wardrobe, posture, environment and social context to evolve naturally. Do not use earlier clothing, hair or location as continuity anchors unless the story explicitly requires them.

---

# 48. Suggested Reference Image Rule

> Reference images should preserve only the dimensions that remain logically continuous. When time or context changes, treat previous images as identity references rather than full-scene templates. Do not inherit previous wardrobe, hairstyle, age, pose, environment, lighting or camera composition unless the current story state requires them.

---

# 49. Implementation Strategy for the Existing Kisago Codebase

The AI coder should first inspect the existing image-composer pipeline and identify:

1. where narrative beats are created,
2. where character descriptions are assembled,
3. where continuity instructions are added,
4. where reference images are selected,
5. where four-panel prompts are compiled,
6. where camera directions are generated,
7. whether storyboard panels already have structured metadata,
8. whether a vision-based evaluation pass already exists,
9. whether handoff / project rules already define visual consistency behaviour.

Do **not** immediately rewrite the system.

First produce a mapping:

```text
CURRENT COMPONENT
→ CURRENT RESPONSIBILITY
→ FAILURE RISK
→ PROPOSED CHANGE
→ MINIMAL IMPLEMENTATION
```

Then implement the smallest architectural change that supports:

```text
LOCKED / EVOLVE / FREE
+
Visual State Delta
+
Temporal Transition Detection
```

These three mechanisms should solve the largest class of failures.

---

# 50. Recommended Implementation Phases

## Phase 1 — Minimal high-impact fix

Implement:

- transition detection,
- `LOCKED / EVOLVE / FREE`,
- replacement continuity instruction,
- `must_not_inherit`,
- character presence / absence enforcement.

## Phase 2 — Cinematic improvements

Implement:

- panel story function,
- camera intent,
- shot diversity check,
- deliberate visual echo tagging.

## Phase 3 — Rich state management

Implement:

- prop lifecycle,
- physical-state continuity,
- environment-state continuity,
- relationship geometry,
- visual state deltas.

## Phase 4 — Evaluation

Implement:

- contradiction checking,
- optional vision evaluation,
- targeted regeneration.

---

# 51. Success Criteria

The new system should pass tests where:

### Test A — Same continuous scene

Expected:
- same clothes,
- same environment,
- same props,
- strong causal continuity,
- camera may vary.

### Test B — Several years later

Expected:
- same identity,
- aged appearance,
- evolved body proportions,
- context-appropriate hairstyle,
- new wardrobe,
- old environment not automatically reused.

### Test C — New location

Expected:
- same characters,
- visually distinct environment,
- no cloned architecture unless explicitly same venue.

### Test D — Character absent

Expected:
- absent character does not leak into panel.

### Test E — Prop continuation

Expected:
- same object remains consistent across sequential action.

### Test F — Emotional progression

Expected:
- posture and expression evolve rather than repeat.

### Test G — Cinematic storyboard

Expected:
- panels have distinct but motivated compositions,
- no repetitive eye-level medium shots unless intentional.

### Test H — Deliberate visual echo

Expected:
- intentionally repeated framing survives validation.

---

# 52. Recommended Regression Test Stories

Create a small internal test suite containing anonymized generic story patterns:

1. child → adult after 10+ years,
2. same character across three days,
3. same room, continuous conversation,
4. travel from home to another city,
5. flashback to childhood,
6. injury followed by immediate rescue,
7. same prop across multiple panels,
8. character absent in one panel,
9. emotionally distant relationship becoming trusting,
10. deliberate same-frame visual rhyme years later.

Use these cases whenever prompt-composer logic changes.

---

# 53. Final Design Principle

The composer should be built around this distinction:

```text
CONTINUITY ≠ SAMENESS
```

Instead:

```text
Continuity = preservation of narrative identity, causality, world logic and emotional history.
```

And:

```text
Evolution = believable change in everything the story says has changed.
```

And:

```text
Creative freedom = cinematic interpretation where story logic does not require literal preservation.
```

The system should therefore preserve:

```text
what must remain
```

evolve:

```text
what logically changes
```

and creatively reinterpret:

```text
what the story leaves open.
```

That balance should be the default behaviour for all Kisago stories.

---

# 54. Starter Prompt for the AI Coder

Use the following prompt together with this document.

```text
You are working inside the existing Kisago codebase.

Read the attached document:
"Kisago Visual Composer — Continuity, Temporal Evolution & Cinematic Storytelling Framework.md"

Treat it as a design specification and reasoning framework, not as instructions to blindly rewrite the current implementation.

First inspect the existing visual/image composer pipeline, existing handoff/project rules, prompt builders, character-state handling, storyboard generation, reference-image usage and any existing validation or evaluation logic.

Your first task is to produce a concise implementation map showing:

1. where continuity is currently introduced,
2. where character appearance is persisted,
3. where temporal/location changes are interpreted,
4. where panel-level camera instructions are generated,
5. where reference images influence later generations,
6. which existing structures can support this framework without unnecessary architectural change,
7. where the current implementation is likely causing continuity to become visual sameness.

Then propose the smallest robust implementation that introduces these core concepts:

- attribute-level continuity states: LOCKED / EVOLVE / FREE,
- temporal and spatial transition analysis,
- per-panel visual state,
- visual state delta: remains / changes / new / disappears,
- must_not_inherit,
- separation of persistent character identity from current appearance state,
- character presence / absence enforcement,
- cinematic story function per panel,
- motivated shot diversity,
- continuity contradiction checks.

Important:

- Keep the implementation generic and character-agnostic.
- Do not hard-code the example story, character names, locations, ages or visual style.
- Preserve existing working architecture and interfaces wherever practical.
- Reuse current handoff/state mechanisms if they already solve part of the problem.
- Do not force arbitrary visual variation.
- Strong causal continuity must remain for uninterrupted actions.
- A time jump or location change should trigger re-evaluation, not automatic inheritance.
- Character identity should persist without forcing the same clothing, hairstyle, environment or pose.
- Camera composition should be driven by dramatic function, not inherited by default.
- Repeated framing must remain possible when intentionally marked as a visual echo.
- Keep the canonical logic model-agnostic so it can work with different image-generation providers.

Before changing code, show me:

A. your understanding of the current architecture,
B. the specific failure points you found,
C. the proposed data structures / interfaces,
D. the files/modules you plan to change,
E. a phased implementation plan.

After that, implement the solution, update or create tests, and document the behaviour in the project's existing handoff or rule system so future AI coding sessions understand the new continuity model.
```

---

# 55. Suggested Handoff Note

After implementation, add a persistent project note roughly equivalent to:

```text
Visual continuity in Kisago is attribute-specific.

Never equate character continuity with preserving all visible attributes.

For every panel transition:
1. infer temporal/spatial relationship,
2. classify important attributes as LOCKED / EVOLVE / FREE,
3. compute visual state delta,
4. preserve causal continuity,
5. re-evaluate wardrobe, hair, environment and body language after major transitions,
6. choose cinematography from panel story function,
7. prevent accidental camera repetition,
8. allow deliberate visual echoes when tagged.

Persistent character identity and current appearance state are separate concerns.
```

This should be placed wherever Kisago currently stores project-wide AI coding rules, handoff context, or image-composer architecture notes.

---

# 56. Recommended Adoption Path

The safest way to incorporate this into Kisago is:

1. **Attach this file to the AI coder.**
2. Use the starter prompt above.
3. Ask the coder to inspect before modifying.
4. Let it map the framework onto the existing architecture.
5. Implement only the minimal high-impact layer first.
6. Run regression tests against both:
   - uninterrupted scenes,
   - major time/location transitions.
7. Compare storyboard output before/after.
8. Only then add richer cinematic and post-generation evaluation logic.

Do not begin by expanding the image prompt with more prose.

The major improvement should come from **better internal visual-state reasoning before prompt compilation**, not simply from longer prompts.
