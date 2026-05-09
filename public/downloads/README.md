# ApplyFlow Edge Assistant (MVP)

## Included files
- `manifest.json`
- `popup.html`
- `popup.js`
- `content.js`
- `content.css`

## MVP scope
- Popup displays:
  - site support level (high / medium / low)
  - profile readiness status
  - field-level fill results
  - one-click fill action
  - link to ApplyFlow Profile/Resume page
- Supported field controls:
  - `plain_input`
  - `textarea`
  - `searchable_select` (minimal + dialog fallback)
  - `date_picker` (read/write minimal strategy)
  - `radio_group`
- Supported profile fields:
  - `full_name`, `email`, `phone`, `gender`
  - `school_name`, `first_school_name`, `degree`, `major`, `first_major`
  - `birth_date`, `bachelor_start_date`, `bachelor_end_date`, `master_start_date`, `master_end_date`
  - `language_exam_language`, `language_exam_level`, `language_name`, `english_proficiency`, `english_score`
  - `certificate_name`, `achievement_score`
  - `summary`

## Explicitly not supported in this MVP
- auto submit
- multi-step apply flows
- ATS-specific adapters (Workday/Greenhouse/Lever)
- fully automated advanced date picker interactions
- file upload automation
