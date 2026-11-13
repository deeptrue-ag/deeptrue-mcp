# deeptrue MCP

Model Context Protocol server for [deeptrue](https://www.deeptrue.ch). Use it from **Cursor**, **Claude** (Desktop and connectors), and **OpenAI/ChatGPT**.

This repository is the standalone server. It does not depend on the deeptrue monorepo. Cursor (and other stdio clients) spawn the process and pass `DEEPTRUE_API_KEY`.

## What it does

Exposes research-assistant tools over one API, `https://api.deeptrue.ch`:

- Organizations / active org
- Projects, briefing, accept / collect / finish / archive
- Surveys, statistics, respondents (PII redacted by default)
- Panel status / demands (Cint, Bilendi, Dynata)
- Report files and layouts

Every tool uses that origin. There is no separate survey host.

## Run with npx (stdio)

No clone is required. `npx` installs this GitHub repository, builds it, and runs the `deeptrue-mcp` binary. With no arguments the binary speaks MCP over stdio.

```json
{
  "mcpServers": {
    "deeptrue": {
      "command": "npx",
      "args": ["-y", "github:deeptrue-ag/deeptrue-mcp"],
      "env": {
        "DEEPTRUE_API_BASE": "https://api.deeptrue.ch",
        "DEEPTRUE_API_KEY": "dt_…"
      }
    }
  }
}
```

`DEEPTRUE_API_KEY` is the only value you must set. The key is created under **Settings → MCP API keys** on [app.deeptrue.ch](https://app.deeptrue.ch/settings/mcp-api-keys). `DEEPTRUE_ORG` is optional; omit it to use the organization stored on the key. Set `DEEPTRUE_API_BASE` only when the key belongs to another deeptrue environment.

The same block is in [`mcp.example.json`](./mcp.example.json). Put it in Cursor’s project or user `mcp.json`. Keep the `dt_…` secret in that local file or a password manager. Do not commit it.

Requires Node.js `>=20.9.0`.

## Remote HTTP

Point the client at `https://mcp.deeptrue.ch/mcp`.

1. Complete OAuth against `https://api.deeptrue.ch` (`/.well-known/oauth-authorization-server`).
2. **API key headers** (`Authorization: Bearer dt_…` or `X-DeepTrue-Api-Key`) work for stdio and clients that support static headers.
3. **OpenAI / ChatGPT (remote)** uses **OAuth only**. Do not paste a `dt_…` API key into ChatGPT connector settings.

OAuth redirect allowlists include Cursor, Claude, and ChatGPT callbacks. `GET /healthz` on the MCP host returns `{ "ok": true, "service": "deeptrue-mcp" }`.

## Environment

| Variable | Purpose |
| --- | --- |
| `DEEPTRUE_API_KEY` | `dt_…` key for stdio. Required. |
| `DEEPTRUE_API_BASE` | API origin. Default `https://api.deeptrue.ch`. |
| `DEEPTRUE_ORG` | Optional default org domain/slug |
| `MCP_PUBLIC_URL` | Public MCP URL (OAuth resource indicator). Default `https://mcp.deeptrue.ch`. |
| `DEEPTRUE_OAUTH_ISSUER_URL` | OAuth issuer (default: API origin) |
| `MCP_PORT` / `MCP_BIND_HOST` | HTTP listen settings |
| `MCP_ALLOWED_HOSTS` | Comma-separated Host allowlist for HTTP |

## Create an API key

In the deeptrue dashboard, open **Settings → MCP API keys**. The secret starts with `dt_` and is shown once. Store it as `DEEPTRUE_API_KEY`.

People who already have a dashboard JWT can also create a key:

```bash
curl -X POST https://api.deeptrue.ch/v1/auth/mcp/keys/ \
  -H "Authorization: JWT <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"cursor"}'
```

## Clone and run

```bash
git clone https://github.com/deeptrue-ag/deeptrue-mcp.git
cd deeptrue-mcp
npm install
npx deeptrue-mcp
```

`npm install` builds `dist/` (the `prepare` script). `npx deeptrue-mcp` with no arguments starts stdio. `npm run dev` serves Streamable HTTP.

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
