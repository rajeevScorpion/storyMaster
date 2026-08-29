# Phase 0 Prompt — Investigation Before Implementation

Use this prompt after the starter prompt if the AI coder needs a focused investigation task.

## Task
Investigate the Kissago codebase to understand the current Gemini image generation flow and all related systems.

Do not implement yet.

## Find and document

### A. Current image generation flow
- Where image prompts are generated
- Where Gemini API is called
- Whether image generation is sync/async
- Whether beat images and story/reel images share the same pipeline
- How generated image URLs/files are saved
- How metadata is saved
- How errors are handled
- How retries/regeneration works

### B. Story/reel generation flow
- Where story creation starts
- Where beat generation happens
- Where reel generation happens
- How generated assets are connected to beats/scenes
- Whether story-level settings exist

### C. Coin/wallet system
- Whether coins are deducted now for image generation
- Whether deduction happens before or after generation
- Whether refunds exist
- Whether coin transactions are logged
- Whether idempotency exists
- Whether subscription/plan limits exist separately

### D. Admin and tier system
- Whether there is an admin panel
- Whether admin settings are DB-driven or config-driven
- Whether user tiers/plans already exist
- How tier permissions are represented
- How features are enabled/disabled

### E. Provider/API configuration
- How environment variables are managed
- Whether there is a service config pattern
- Whether API keys are encrypted or env-only
- Whether multiple provider keys can be safely added

### F. Tests and deployment safety
- Existing tests
- Build commands
- Type checks/lint
- Migration process
- Feature flag system if any
- Logging/monitoring system if any

## Required output
Return a written investigation report containing:
1. Current architecture map
2. Files/modules inspected
3. Key findings
4. Risks
5. Recommended implementation plan
6. Targeted clarifying questions based only on findings
7. First safe commit plan

Do not make generic assumptions.

