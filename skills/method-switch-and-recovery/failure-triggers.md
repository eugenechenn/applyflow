# Failure Triggers

Trigger this skill when one or more of the following is true.

## Hard Triggers

- Same problem category remains unresolved after 2 rounds.
- A previously fixed issue reappears.
- A fix causes visible regression in another part of the same page.
- Old and new render paths are visible on the same screen.
- Core module becomes empty again after a recent fix.
- Garbled text / mojibake reappears in user-visible UI.

## ApplyFlow-Specific Triggers

- Dashboard recommendations become garbled again.
- Job Detail next-action banner becomes garbled again.
- Tailoring workspace loses left or right pane again.
- Job summary falls back to “建议人工补充确认” style placeholder text again.
- Base resume section mapping becomes unstable again.
- Tailored resume becomes empty or falls back to non-resume narrative again.

## Trigger Threshold

Use this skill immediately if:

- there are 2 consecutive failed acceptance rounds in the same area
- or the user reports “still failing” after a deploy
- or regression happens across both data and UI layers

## Do Not Trigger For

- isolated cosmetic issues with stable data
- one-off copy changes
- a single missing label without structural impact
