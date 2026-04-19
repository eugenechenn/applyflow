---
name: method-switch-and-recovery
description: Use this skill when ApplyFlow enters repeated failure, regression, mixed old/new rendering, schema drift, encoding regression, or multi-round unresolved bugs. It governs whether to continue patching, pause to stabilize schema/encoding, rollback, or switch implementation method before touching business code again.
---

# Method Switch And Recovery

## Purpose

This skill exists to stop uncontrolled patching when a feature area has entered repeated failure or regression.

Use it to decide:

- whether the current method is still valid
- whether to keep patching or switch method
- which files are safe to change this round
- which validation gates must pass before new feature work resumes

## When To Use

Run this skill before changing business code when any of these happen:

- the same category of bug remains unresolved after 2 rounds
- a previous fix regresses
- encoding/garbled text reappears
- old and new rendering logic mix together
- schema changed but UI still reads old fields
- one side of a core workspace becomes empty again

Read:

- [failure-triggers.md](failure-triggers.md) to confirm whether the skill should trigger
- [decision-matrix.md](decision-matrix.md) to choose the right recovery path
- [validation-gates.md](validation-gates.md) before implementing a fix
- [examples.md](examples.md) when the failure pattern is unclear
- [decision-log-template.md](decision-log-template.md) to record the decision

## Inputs

- current failure symptoms from screenshots, logs, API payloads, or user reports
- affected page or workflow
- current schema / payload shape
- recent files changed in the failed area
- whether regression or rollback happened

## Outputs

- root-cause judgment
- whether to keep current method or switch method
- allowed change boundary for this round
- explicit validation gates
- a short decision log entry

## Process

1. Confirm trigger conditions using [failure-triggers.md](failure-triggers.md).
2. Classify the failure:
   - encoding / text corruption
   - schema drift
   - old/new render mixing
   - weak modeling
   - bad upstream parsing
3. Use [decision-matrix.md](decision-matrix.md) to decide:
   - patch
   - rollback
   - stabilize schema first
   - fix encoding chain first
   - switch method
4. Freeze change scope:
   - list files that may be edited
   - list files that must not be touched this round
5. Lock validation gates from [validation-gates.md](validation-gates.md).
6. Record the decision using [decision-log-template.md](decision-log-template.md).
7. Only after that, start implementation.

## ApplyFlow Notes

- For workspace failures, never patch the UI first if payload/schema is unclear.
- If output text is garbled, fix encoding or sanitize display chain before tuning business wording.
- If section extraction keeps failing, move from sentence-list rendering to entity modeling instead of adding more heuristics on top of dirty output.
- If old and new UI coexist, remove one path before improving visual details.
