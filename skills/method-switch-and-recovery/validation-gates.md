# Validation Gates

These gates must be locked before implementation starts.

## Universal Gates

- User-visible pages must not contain garbled text.
- One page must not mix old and new render logic.
- Changed area must have one clear source of truth.

## ApplyFlow Workspace Gates

- Job summary must show usable content, not placeholder disclaimers.
- Work experience must render by entity:
  - company
  - role
  - timeRange
  - bullets
- Project experience must render by entity:
  - projectName
  - role
  - timeRange
  - bullets
- Base resume and tailored resume must both be visible.
- Right pane must show a usable first tailored resume, not empty state.
- Job judgment must not consume dirty placeholders or parsing notes.

## Dashboard / Job Detail Gates

- Dashboard recommendation cards must be readable Chinese.
- Dashboard todo items must not leak English residual text.
- Job Detail next-action banner must render readable Chinese title + CTA.

## Acceptance Rule

Do not call a round complete if any of these remain true:

- 乱码 still visible
- one pane still empty
- work/project entities still collapse into sentence blobs
- “建议人工补充确认” remains in primary summary area
- old panel and new workspace still coexist
