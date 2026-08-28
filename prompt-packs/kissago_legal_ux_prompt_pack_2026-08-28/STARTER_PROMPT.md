# Starter Prompt for the AI Coder

You are working on the **Kissago** production codebase.

A product/legal UX improvement pack has been provided in the folder:

`kissago_legal_ux_prompt_pack_2026-08-28/`

Treat that folder as the planning and seed-content reference, **not as unquestionable truth about the codebase**.

Start by reading:
1. `README.md`
2. `prompts/01_CODEBASE_AUDIT.md`

Then execute Prompt 01 only.

Important rules:
- Do not change production code before completing the factual audit.
- Inspect the actual auth, database, footer/legal CMS, OAuth, subscription, AI, public sharing, child/family, vendor and data flows.
- Never expose secrets.
- Never invent legal entity details, addresses, emails, payment providers, AI providers, retention periods or compliance claims.
- Seed legal content contains placeholders and recommendations that must be reconciled with the real implementation.
- Pay particular attention to whether minors can independently create accounts and whether Google/OAuth can bypass the Terms acceptance gate.
- Document findings in `/docs/legal-auth-audit.md` as instructed.
- After the audit, stop and present the findings, blockers and proposed implementation plan for approval before running Prompt 02.
