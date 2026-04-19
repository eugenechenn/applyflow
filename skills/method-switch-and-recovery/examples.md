# Examples

## Bad Case 1: Repeated Rule Patching On Noisy Sections

Symptoms:

- work experience still appears as flat sentence list
- project experience keeps leaking into work experience
- self-summary still contaminates experience blocks

What went wrong:

- current method only patched section heuristics
- no entity structure was introduced
- UI target required structured entities but data remained flat

Correct decision:

- switch method
- move from sentence segmentation to entity modeling

## Bad Case 2: Schema Changed But UI Still Mixed Old Logic

Symptoms:

- new workspace is present
- old execution / prep / diff panels still render on same page
- user sees mixed product and debug-like sections

What went wrong:

- backend/schema changed, but old render path stayed mounted
- page had more than one source of truth

Correct decision:

- stabilize render path first
- remove old render blocks
- only then refine copy or layout

## Bad Case 3: Encoding Fix Skipped

Symptoms:

- content tuning continues while UI still shows mojibake
- judgment copy looks meaningless
- user cannot even judge whether logic improved

What went wrong:

- text corruption issue was treated like a content issue

Correct decision:

- fix encoding / sanitize text chain first
- only then evaluate content quality
