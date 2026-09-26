# Kissago Payment, Billing, Invoicing & Consumption Monetisation — AI Coder Prompt Pack

**Prepared:** 17 September 2026  
**Purpose:** Implement a production-ready payment, billing, invoicing, subscription-management, consumption-entitlement, and billing-support system for Kissago.

## Important packaging rule

This pack **does not contain** the existing audit/research files. They already exist in the repository and must be read **in place**. Do not copy, rename, regenerate, summarize into replacement documents, or bundle them into a new folder.

Required repo references are listed in `SOURCE_REFERENCES.md`.

## How to use this pack

1. Start a fresh coding-agent session on the intended Kissago repository/branch.
2. Paste `STARTER_PROMPT.md`.
3. The agent must complete the discovery/revalidation gate before modifying billing/payment code.
4. If the discovery reveals consequential ambiguity, the agent must stop and ask the owner with:
   - what it found;
   - why the ambiguity matters;
   - 2–3 practical options;
   - its recommended option;
   - codebase/provider consequences.
5. After owner confirmation, run the relevant phase prompt.
6. At the end of every meaningful phase:
   - test;
   - inspect diff;
   - selectively stage only intended files;
   - update the repo's existing project-state/handoff mechanism;
   - commit with a meaningful message;
   - record rollback/disable steps;
   - stop at the phase gate unless the owner explicitly asks to continue.

## Core philosophy

This is a **financially sensitive implementation**. Correctness and premium user experience have equal weight.

The audit/plan are evidence, not commands. The coder must re-check current code, schema, environments, provider behavior, current official documentation, and existing Kissago conventions before choosing implementation details.

The goal is not a rewrite. Preserve sound existing systems and extend them deliberately.
