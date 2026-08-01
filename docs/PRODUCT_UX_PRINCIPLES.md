# Product UX Principles

## Purpose

小智酒店管家的产品界面围绕用户当前的任务、情境与决策需求设计。The interface must not mirror the implementation structure, database schema, service boundaries, or every available capability merely because those concepts exist in code.

This user-centered rule applies to UI, interaction flows, navigation, information architecture, terminology, empty/loading/error states, and product copy. Internal logic remains engineering-centered: model domains accurately, make failure modes explicit, preserve security boundaries, and optimize for correctness and maintainability.

`DESIGN.md` remains the visual source of truth. This document governs what is shown, when it is shown, how it is grouped, and how much attention it receives.

## Start With the User Task

Before designing or changing a surface, write down:

1. Who is acting and what context are they in?
2. What concrete outcome are they trying to reach now?
3. What information is required to make the next decision?
4. What is the shortest safe path to completion?
5. What can fail, and what does the user need to recover?

Organize the flow around the answers, not around APIs, entities, CRUD operations, or backend modules. Use the user's vocabulary. Hide technical identifiers and implementation detail unless the task genuinely requires them.

## Information Density

Information density is the amount of decision-relevant information visible at once, not simply the number of elements on screen.

- Give the current task and primary action the clearest hierarchy.
- Keep essential status, context, and recovery actions visible.
- Remove duplicate labels, repeated summaries, decorative metrics, and explanatory copy that does not change a decision.
- Group related information by user intent; do not give every field equal visual weight.
- Prefer whitespace, alignment, typography, and familiar controls over extra containers and headings.
- Avoid dashboards of cards when a list, table, focused form, or single workspace better matches the task.
- Preserve scanability: stable alignment, concise labels, predictable placement, and meaningful ordering.
- Dense expert workflows may show more data, but only when comparison or rapid repeated action benefits from simultaneous visibility.

A useful test: if removing an element does not make the next action less clear, less safe, or less efficient, remove or defer it.

## Progressive Disclosure

Show the minimum information and controls needed for the current step, while keeping secondary capability easy to discover.

Use progressive disclosure for:

- advanced or rarely changed settings;
- destructive, administrative, or high-risk actions;
- secondary metadata and diagnostics;
- optional configuration after a sensible default is available;
- long explanations, policy detail, and uncommon recovery paths;
- controls that only become relevant after a prior choice.

Appropriate patterns include expandable sections, dialogs, contextual menus, details panels, staged flows, and “advanced” groups. Choose the smallest established pattern that preserves context.

Do not hide:

- the primary action;
- current status or irreversible consequences;
- information required to choose correctly;
- validation and recovery guidance at the moment it is needed;
- security, consent, cost, privacy, or destructive impact;
- frequently used actions merely to make a screen look minimal.

Progressive disclosure is not arbitrary concealment. A control should be deferred because it is secondary in the user's task, not because the layout is inconvenient.

## Defaults and Decision Cost

- Provide safe, useful defaults when the product has enough context.
- Ask only for information required now; defer future configuration.
- Preserve user choices when doing so is safe and expected.
- Avoid making users translate internal terminology or compute derived meaning mentally.
- Use recognition over recall: visible choices, recent context, and clear current state.
- Keep the number of competing primary actions to one per task region whenever possible.
- Make secondary actions visually quieter without making them inaccessible.

## Flow and Feedback

- Keep users in context during short secondary tasks; use a dialog or panel when navigation would disrupt the main task.
- Use a dedicated page when the task is complex, long-running, or benefits from stable navigation and deep linking.
- Acknowledge actions immediately with disabled/loading states where duplicate submission is possible.
- Show success feedback only when the outcome is not already obvious from the changed interface.
- Place validation near the affected field or action and preserve entered data.
- Errors must explain what happened in user language, what remains safe, and the next recovery action when one exists.
- Do not expose stack traces, IPC wording, raw server errors, filesystem paths, or implementation terminology.
- Design empty states around the next useful action, without promotional or tutorial filler.

## Product Copy

- Use concise, concrete, task-oriented language.
- Name actions with verbs that describe the outcome.
- Use the user's domain terms consistently across navigation, headings, controls, errors, and confirmation messages.
- Do not narrate obvious UI, restate headings, or add helper copy merely to fill space.
- Keep necessary copy for ambiguity reduction, validation, recovery, destructive actions, security, privacy, consent, and accessibility.
- Do not claim success before the underlying operation succeeds.

## Restraint

- Implement the requested outcome without inventing adjacent features, sections, onboarding, promotional content, filters, badges, metrics, or controls.
- Choose the simplest layout consistent with nearby product surfaces.
- Prefer an existing standard component plus small composition over a novel interaction pattern.
- If the behavioral requirement leaves layout open, make the smallest reasonable decision that supports the user task.
- A technically available capability is not automatically a product requirement.

## Accessibility Is Part of the Task

- Preserve semantic structure, keyboard access, visible focus, accessible names, and correct reading order.
- Do not communicate meaning through color alone.
- Ensure progressive disclosure controls expose state and relationships to assistive technology.
- Keep error and status feedback perceivable and associated with the relevant task.
- Avoid interaction density that makes targets difficult to distinguish or operate.

## Design Review Checklist

Before implementation:

- Is the user outcome stated independently of the implementation?
- Is every persistently visible element needed for the current task or a frequent adjacent action?
- Are advanced and rare controls disclosed progressively?
- Are the primary action, current state, and recovery path clear?
- Does terminology match the user's domain rather than internal architecture?
- Is the layout the simplest one consistent with `DESIGN.md` and nearby screens?

Before handoff:

- Can the primary task be completed without reading unnecessary explanation?
- Are loading, empty, success, disabled, validation, and error states appropriate?
- Is important information discoverable without exposing all secondary detail at once?
- Do keyboard and assistive-technology users receive the same task context and feedback?
- Did the change avoid speculative product scope?
