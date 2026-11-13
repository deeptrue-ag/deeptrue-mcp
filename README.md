# deeptrue MCP

Model Context Protocol server for [deeptrue](https://www.deeptrue.ch). Use it from **Cursor**, **Claude** (Desktop and connectors), and **OpenAI/ChatGPT**.

This repository is the standalone server. It does not depend on the deeptrue monorepo. Cursor (and other stdio clients) spawn the process and pass environment variables, including `DEEPTRUE_API_KEY` and the API base URLs.

## What it does

Exposes research-assistant tools over the deeptrue HTTP API (`/v1`) and the survey-engine API (`/v1`):

- Organizations / active org
- Projects, briefing, accept / collect / finish / archive
- Surveys, statistics, respondents (PII redacted by default)
- Panel status / demands (Cint, Bilendi, Dynata)
- Report files and layouts

## Run with npx (stdio)

No clone is required. `npx` installs this GitHub repository, builds it, and runs the `deeptrue-mcp` binary. With no arguments the binary speaks MCP over stdio.

```json
{
  "mcpServers": {
    "deeptrue": {
      "command": "npx",
      "args": ["-y", "github:deeptrue-ag/deeptrue-mcp"],
      "env": {
        "DEEPTRUE_API_BASE": "http://127.0.0.1:8001",
        "DEEPTRUE_SURVEY_ENGINE_BASE": "http://127.0.0.1:8050",
        "DEEPTRUE_API_KEY": "dt_…",
        "DEEPTRUE_ORG": "public"
      }
    }
  }
}
```

`DEEPTRUE_ORG` must be the organization shown on the key, or you can omit it. `public` is the local example organization. Point `DEEPTRUE_API_BASE` at `https://api.dev.deeptrue.ch` or `https://api.deeptrue.ch` when the key belongs to that environment, and set `DEEPTRUE_SURVEY_ENGINE_BASE` to `https://api.survey.dev.deeptrue.ch` or `https://api.survey.deeptrue.ch`.

The same block is in [`mcp.example.json`](./mcp.example.json). Put it in Cursor’s project or user `mcp.json`. Keep the `dt_…` secret in that local file or a password manager. Do not commit it.

Requires Node.js `>=20.9.0`.

## Clone and run

```bash
git clone https://github.com/deeptrue-ag/deeptrue-mcp.git
cd deeptrue-mcp
npm install
npx deeptrue-mcp
```

`npm install` builds `dist/` (the `prepare` script). `npx deeptrue-mcp` with no arguments starts stdio. To serve Streamable HTTP on port 3100:

```bash
npm run dev
# or, after the build: npm start
```

The HTTP endpoint is `http://127.0.0.1:3100/mcp`. `GET /healthz` returns `{ "ok": true, "service": "deeptrue-mcp" }`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DEEPTRUE_API_BASE` | Backend base (default `http://127.0.0.1:8001`) |
| `DEEPTRUE_SURVEY_ENGINE_BASE` | Survey-engine base (default `http://127.0.0.1:8050`) |
| `DEEPTRUE_API_KEY` | `dt_…` key for stdio |
| `DEEPTRUE_ORG` | Optional default org domain/slug |
| `MCP_PUBLIC_URL` | Public MCP URL (OAuth resource indicator). Planned hosts: `https://mcp.dev.deeptrue.ch` and `https://mcp.deeptrue.ch` |
| `DEEPTRUE_OAUTH_ISSUER_URL` | OAuth issuer (default: API origin) |
| `MCP_PORT` / `MCP_BIND_HOST` | HTTP listen settings |
| `MCP_ALLOWED_HOSTS` | Comma-separated Host allowlist for HTTP (default `127.0.0.1,localhost`) |

## Create an API key

In the deeptrue dashboard, open **Settings → MCP API keys**. The secret starts with `dt_` and is shown once. Store it as `DEEPTRUE_API_KEY`.

People who already have a dashboard JWT can also create a key against the API origin (the same host you set as `DEEPTRUE_API_BASE`, which does not include `/v1`):

```bash
curl -X POST http://127.0.0.1:8001/v1/auth/mcp/keys/ \
  -H "Authorization: JWT <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"cursor-local"}'
```

Hosted origins are `https://api.dev.deeptrue.ch` and `https://api.deeptrue.ch`.

## Remote HTTP and OAuth

1. Run `npm run dev` (or point the client at a hosted MCP URL such as `https://mcp.dev.deeptrue.ch/mcp` or `https://mcp.deeptrue.ch/mcp` once that host is deployed).
2. Complete OAuth against the API issuer (`/.well-known/oauth-authorization-server` on the deeptrue API).
3. **API key headers** (`Authorization: Bearer dt_…` or `X-DeepTrue-Api-Key`) work for stdio, local HTTP, and clients that support static headers.
4. **OpenAI / ChatGPT (remote)** uses **OAuth only**. Do not paste a `dt_…` API key into ChatGPT connector settings.

OAuth redirect allowlists include Cursor, Claude, and ChatGPT callbacks.

## Develop

```bash
npm install
npm run typecheck
npm test
npm run dev
```

## Safety

Mutating tools require `confirm=true` and write scopes. `update_survey_structure` only accepts `name`, `json`, `survey_template_uuid`, and `id`. Prefer `get_project` / `get_survey` before edits. Respondent PII requires `include_pii=true` **and** the `mcp:pii` scope (not included in `mcp:write`).

Organization is per request. Pass the tool's `organization` argument, send `X-DeepTrue-Org` on HTTP, or set `DEEPTRUE_ORG` for stdio. `set_active_organization` only checks that the org is usable; it does not stick on stateless HTTP.

Panel list/status routes (`cint/status`, `cint/demands`, `bilendi/projects`, `dynata/status`, and their audit lists) are deeptrue-admin APIs. A non-admin gets a 403; the tool reports that refusal instead of an empty success. Report HTML upload is admin-only as well. Report file list/get uses `projects/reports/`, which organization members can call.

The session JWT is retried once after an API 401 by exchanging a new session. Revoking the API key makes the next exchange fail with 401.

## License

[MIT](./LICENSE) © deeptrue AG
