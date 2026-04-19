# Decision Matrix

Use this matrix after confirming the skill is triggered.

## 1. Keep Patching Current Method

Use only when:

- root cause is clearly isolated
- no regression pattern exists
- schema is stable
- rendering logic is singular

Typical examples:

- one missing import
- one wrong field mapping
- one conditional render bug

## 2. Fix Encoding Chain First

Choose this when:

- user-visible strings are garbled
- API payload contains mojibake
- DB or text template pollution is suspected
- copy evaluation is impossible because text is corrupted

Before any product/content tuning:

- stabilize UTF-8 path
- sanitize payload/display layer
- confirm pages render readable text again

## 3. Stabilize Schema / View-Model First

Choose this when:

- backend payload changed but frontend still reads old fields
- one page mixes old and new data structures
- one route returns hybrid data
- left/right workspace panes depend on different payload generations

Do this before UI polish.

## 4. Switch Method

Choose this when:

- the same failure persists across 2 or more rounds
- current method depends on noisy text or placeholders
- repeated heuristics still produce wrong entities
- display target requires structured objects but current pipeline only yields flat strings

Typical ApplyFlow example:

- sentence-list section extraction keeps failing
- target UI needs:
  - company / role / timeRange / bullets
  - projectName / role / timeRange / bullets

Then switch to:

- entity modeling -> workspace view model -> render

## 5. Roll Back First

Choose this when:

- current deployment is worse than last known good version
- user cannot complete the main workflow
- page is mixed, broken, or blocked

Rollback is appropriate only when:

- a known-good state exists
- current branch introduces severe regressions

## 6. Freeze Scope

After choosing a path, explicitly mark:

- files allowed this round
- files forbidden this round

Example:

- allowed: parser, schema builder, view-model, one page renderer
- forbidden: unrelated dashboard styling, new agent logic, extra workflow features
