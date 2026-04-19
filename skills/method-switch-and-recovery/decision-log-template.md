# Decision Log Template

Use this template before starting a recovery round.

## Failure Symptoms

- page:
- route:
- visible regression:
- screenshots / logs:

## Trigger Check

- repeated failure: yes / no
- regression after previous fix: yes / no
- mixed old/new render logic: yes / no
- encoding issue: yes / no
- schema drift: yes / no

## Root Cause Judgment

- primary cause:
- secondary cause:
- affected layer:
  - parser
  - schema/model
  - view-model
  - render
  - encoding

## Decision This Round

- continue patching / rollback / fix encoding first / stabilize schema first / switch method

## Allowed Change Scope

- files allowed:
- files forbidden:

## Validation Gates

- gate 1:
- gate 2:
- gate 3:

## Result

- deployed: yes / no
- acceptance result:
- remaining gaps:
