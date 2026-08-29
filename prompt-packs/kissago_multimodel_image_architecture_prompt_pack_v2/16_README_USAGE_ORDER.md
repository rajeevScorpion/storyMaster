# Kissago Multi-Model Image Architecture Prompt Pack V2

## What changed in this version
This version is structured as a real execution pack.

It now includes:
- a proper starter prompt
- an investigation-first workflow
- no premature standalone generic clarifying-question file
- post-investigation recommendation prompt
- phased implementation prompts
- realistic coin-system handling
- admin tier-wise model inclusion/exclusion
- future scope for character/scene references
- strict “nothing working should break” discipline
- commit discipline

## Recommended usage order

### Step 1
Use:
`00_START_HERE__STARTER_PROMPT_COPY_THIS_FIRST.md`

This is the first prompt to paste into the AI coder.

It instructs the coder to investigate first and not start coding.

### Step 2
If the coder needs a more focused discovery task, use:
`02_INVESTIGATION_PHASE_PROMPT.md`

### Step 3
After the coder investigates, use:
`03_POST_INVESTIGATION_RECOMMENDATION_PROMPT.md`

This asks the coder to make practical recommendations and ask targeted clarifying questions based on real codebase findings.

### Step 4
After you approve the plan, execute phases:
- `04_PHASE_1_SAFE_BASELINE_AND_GEMINI_ADAPTER.md`
- `05_PHASE_2_MODEL_REGISTRY_ADMIN_TIERS.md`
- `06_PHASE_3_COIN_COST_ENGINE.md`
- `07_PHASE_4_USER_MODEL_SELECTION_FLOW.md`
- `08_PHASE_5_OPENAI_IMAGE_PROVIDER.md`
- `09_PHASE_6_XAI_GROK_IMAGE_PROVIDER.md`
- `10_PHASE_7_CONSISTENCY_FOUNDATION.md`
- `11_PHASE_8_TESTING_QA_ROLLOUT.md`

### Step 5
Use these throughout:
- `12_EDGE_CASES_AND_WORKAROUNDS.md`
- `13_COMMIT_AND_EXECUTION_DISCIPLINE.md`
- `14_ACCEPTANCE_CHECKLIST.md`

### Optional
After the plan is approved, use:
`15_ONE_SHOT_EXECUTION_PROMPT_AFTER_APPROVAL.md`

## Key instruction
The coder must not assume. It must investigate, ask practical questions, recommend, then execute safely.

