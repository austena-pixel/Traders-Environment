# T-IOS individual trade Execution score

The existing `trades.execution_score` field remains the saved 0–10 score for one individual trade. No table or column changes are required.

## Combined score

When trade-specific mapped reviews are present, Execution combines three areas with equal weight:

- Psychology
- Playbook / Edge
- Rules

Within each area, every measurable item contributes equally. A checked condition earns 1 point and an unchecked condition earns 0. A radio-choice group counts as one item and earns 1 when an option is selected. A numeric reflection score from 0 to 10 is normalized to a 0–1 item value. Conditional requirements contribute only when their prerequisite makes them applicable; a logical condition group contributes once according to its AND, OR, or exclusive rule.

Execution averages the measurable items within each area, then averages the three area scores equally and stores the result on the 0–10 scale:

`execution_score = ((psychology_mean + playbook_edge_mean + rules_mean) / 3) × 10`

An overall score remains null until each of the three areas has at least one measurable saved input. Text-only reflection answers remain available as journal evidence but do not add points. Older trades with no mapped trade-specific category reviews continue to use their existing legacy score.

The Journal shows the combined score out of 10. Its existing review grade remains A+ when there are no missed measurable items, A when one item is missed, and B when more than one is missed. Incomplete combined reviews remain pending and are not included as completed graded reviews.

## Statistics integration

Statistics should continue reading the existing `trades.execution_score` value in the 0–10 format. For mapped reviews it represents the equal-thirds composite above; null means no review score is available or the three areas are not yet complete. Detailed source answers remain in the existing `trade_execution_reviews` and `trade_execution_checks` records.
