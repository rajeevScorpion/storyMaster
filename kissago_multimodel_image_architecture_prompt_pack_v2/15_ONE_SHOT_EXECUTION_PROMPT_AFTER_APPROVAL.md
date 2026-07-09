# One-Shot Execution Prompt After Plan Approval

Use this only after the AI coder has completed investigation and the plan has been approved.

Proceed with the approved multi-model image generation implementation plan.

Follow these rules strictly:
- Work phase by phase.
- Do not skip tests.
- Do not break existing Gemini behavior.
- Commit after every meaningful phase.
- If a phase reveals unexpected architecture risk, stop and report before continuing.
- If OpenAI or xAI/Grok API details are uncertain, verify official docs before coding.
- Keep admin controls practical and tier-wise.
- Keep coin cost visible and realistic.
- Keep future character/scene reference upload scoped in architecture, not exposed as incomplete UI.
- Keep story-level consistency as a core requirement.

For each phase:
1. State what you will change.
2. Make the change.
3. Run relevant checks.
4. Summarize what changed.
5. Commit with a meaningful message.
6. Move to next phase only if safe.

Begin with the first approved implementation phase.

