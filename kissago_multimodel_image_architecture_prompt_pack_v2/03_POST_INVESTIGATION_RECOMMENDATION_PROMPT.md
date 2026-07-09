# Post-Investigation Recommendation Prompt

Use this only after the AI coder has investigated the codebase.

## Task
Based on your investigation, recommend the safest practical implementation path for multi-model image generation.

## Your recommendation must include

### 1. Minimum safe architecture change
Explain the smallest safe change that lets the system support multiple providers without breaking Gemini.

### 2. Provider abstraction proposal
Recommend the internal provider interface based on the actual codebase.

Include only methods that are useful now, but keep extension points for:
- text-to-image
- image edit
- reference images
- batch generation
- cost estimation
- capability validation

### 3. Data model/config proposal
Recommend how to store:
- provider
- model id/name
- user-facing display name
- enabled/disabled status
- tier availability
- coin cost
- capability flags
- default/recommended marker
- provider config reference

### 4. User flow proposal
Recommend where model selection appears in the story/reel creation flow.

Model selection should show:
- model name
- quality/speed/cost hints if available
- coin cost
- tier lock state if not available
- recommended/default indicator

### 5. Coin flow proposal
Recommend the safest coin deduction flow based on existing system:
- pre-check
- hold/reserve if possible
- charge on success if possible
- refund on failure if needed
- idempotency strategy
- audit log

### 6. Rollout strategy
Recommend:
- feature flag or staged rollout
- Gemini as default fallback
- admin-only testing
- premium tier testing if needed
- logging/monitoring requirements

### 7. Clarifying questions
Ask only final questions required before implementation.

The goal is to move from investigation to practical execution.

