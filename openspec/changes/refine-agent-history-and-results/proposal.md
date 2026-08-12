# Proposal: Refine Agent history and result presentation

## Why

The Agent history rail is visually under-scaled while its destructive bulk action is over-emphasized.
Generated weather trend labels can collide in the available conversation width, and cancelled runs
are rendered after later messages instead of beside the user message that created them. Generative
UI also lacks immediate feedback while the model is preparing a view after a data tool completes.

## What changes

- Rebalance the history rail around readable conversation titles and a quiet icon-only clear action.
- Make trend charts choose a bounded set of readable x-axis labels and compact long date labels.
- Show an explicit lightweight view-building state as soon as `render_hotel_ui` starts and tighten
  its tool guidance so validated UI is emitted before the final narrative.
- Place every terminal execution trace next to its originating user message when no assistant
  message exists, preserving chronological alignment after cancellation.

## Success criteria

- History titles remain comfortably readable without making destructive controls dominant.
- Seven-to-thirty-one-point date trends do not render overlapping x-axis labels at Agent width.
- Users see immediate view-generation feedback and validated UI is still delivered through the
  existing constrained renderer.
- Cancel, new input, new execution and reply remain in chronological pairs.
