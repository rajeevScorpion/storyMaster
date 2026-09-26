# Reusable phase execution prompt

Paste this after approving a specific phase.

---

Proceed with **Phase <N>: <name>** from the Kissago payment/billing prompt pack.

Before editing:
1. re-read the phase prompt;
2. re-read the latest repo handoff/project state/decisions/test status;
3. inspect git status and preserve unrelated work;
4. confirm no new repo changes invalidate the approved plan.

Implement only this phase.

Rules:
- investigate before each consequential edit;
- prefer existing abstractions;
- no speculative rewrite;
- no secret exposure;
- no production/provider mutation unless explicitly part of the approved phase;
- stop and use the decision-gate format if a newly discovered ambiguity affects money, entitlements, tax, retention, legal wording, migrations, or user purchase experience;
- use server-side authority and database-level invariants for financial correctness;
- keep UI coherent with the current Kissago design system;
- add focused tests as you implement;
- update living docs/handoff;
- inspect diff and selectively stage;
- commit after the phase is independently coherent and tested;
- do not push unless asked.

At the end, report:
- findings discovered during implementation;
- changes made;
- migrations/config/provider steps;
- tests and results;
- acceptance criteria met;
- known limitations;
- rollback/disable instructions;
- commit hash;
- exact next recommended phase.

Then STOP.
