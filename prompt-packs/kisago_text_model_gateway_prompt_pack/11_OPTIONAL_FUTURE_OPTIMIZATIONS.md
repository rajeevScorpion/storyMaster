# OPTIONAL FUTURE OPTIMIZATIONS
## Do not implement automatically unless they fit the current scope cleanly

- Admin benchmark runner to compare configured models on the same prompt for quality, latency, tokens, and estimated cost.
- Shadow evaluator comparison: occasionally compare cheap evaluator with a stronger judge to measure agreement.
- Editorial sampling: premium judge only on a small sample of completed stories, not every story.
- Automatic cost budgets: max calls/story, max estimated cost/story, task-specific budgets.
- Provider/model fallback graph: same model via alternate provider, equivalent cheap model, quality escalation. Do not build silent fallback graphs until logging/cost controls are reliable.
- Controlled price metadata refresh rather than runtime scraping.
- Model-role aliases such as creative_writer, cheap_evaluator, planner, classifier, premium_editor if they naturally fit the existing config model.
