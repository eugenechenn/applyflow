# ApplyFlow JD Fetcher on Railway

This service exposes a minimal Playwright-backed HTTP API for ApplyFlow:

- `GET /health`
- `POST /fetch`

Request body:

```json
{
  "url": "https://example.com/job"
}
```

Response fields include:

- `sourceUrl`
- `sourceHost`
- `title`
- `company`
- `location`
- `descriptionText`
- `requirements`
- `preferredQualifications`
- `extractor`

Recommended Railway setup:

1. Connect this repository as a service source.
2. Set `RAILWAY_DOCKERFILE_PATH=deploy/jd-fetcher/Dockerfile`.
3. Generate a public domain.
4. Verify `GET /health` before wiring the URL into `JD_FETCHER_URL`.
