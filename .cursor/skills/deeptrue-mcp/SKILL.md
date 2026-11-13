---
name: deeptrue-mcp
description: >-
  Connects Cursor, Claude, ChatGPT, and Gemini to the deeptrue MCP server and
  calls its survey and research tools. Use when connecting a client, calling
  deeptrue survey or research tools, or debugging MCP config.
---

# deeptrue MCP

Connect a client, then call the tools below. Do not invent tool names, fields, or endpoints.

## Connect

Use one entry. Node.js 20.9 or newer is required for the local command. Create the key under **Settings → MCP API keys** on [app.deeptrue.ch](https://app.deeptrue.ch/settings/mcp-api-keys). The secret starts with `dt_` and is shown once. Keep it in the client config or a password manager. Do not commit it.

### Stdio (Cursor and Claude)

Cursor and Claude Desktop / Claude Code start a local process. With no arguments the command speaks MCP over stdio.

```json
{
  "mcpServers": {
    "deeptrue": {
      "command": "npx",
      "args": ["-y", "github:deeptrue-ag/deeptrue-mcp"],
      "env": {
        "DEEPTRUE_API_BASE": "https://api.deeptrue.ch",
        "DEEPTRUE_API_KEY": "dt_replace_me"
      }
    }
  }
}
```

`DEEPTRUE_API_KEY` is required. `DEEPTRUE_API_BASE` is optional and defaults to `https://api.deeptrue.ch`. `DEEPTRUE_ORG` is optional (organization domain or slug stored on the key is used when it is omitted).

Run the same command directly when checking that the process starts: `npx -y github:deeptrue-ag/deeptrue-mcp`.

### Remote (Claude, ChatGPT, and other URL clients)

```json
{
  "mcpServers": {
    "deeptrue-remote": {
      "url": "https://mcp.deeptrue.ch/mcp"
    }
  }
}
```

- **Claude:** sign in with deeptrue OAuth, or send a `dt_…` key if that client asks for a header (`X-DeepTrue-Api-Key` or `Authorization: Bearer dt_…`).
- **ChatGPT:** OAuth only. Do not paste a `dt_…` key into the ChatGPT connector.
- **Other remote clients:** the same URL. OAuth, or an API key header if the client asks for one.

### Gemini

There is no Gemini-only connector. If Gemini runs a local process, use the stdio block and `DEEPTRUE_API_KEY`. If it connects to a remote server, use `https://mcp.deeptrue.ch/mcp`.

A credential that starts with `dt_` is sent as `api_key`. Any other bearer is sent as `access_token`. Both are posted to `POST https://api.deeptrue.ch/v1/auth/mcp/session/` (optional `organization`). The server uses the session JWT from that response for later tool calls. Do not configure that JWT yourself.

The same exchange is what stdio and other remote clients use before survey and project calls. A 401 on a later API call drops the JWT, exchanges a new session once, and retries. A revoked key fails that exchange.

## Organization

Organization is per call. Pass `organization` on the tool (domain or slug, at most 128 characters), send `X-DeepTrue-Org` on HTTP, or set `DEEPTRUE_ORG` for stdio. `set_active_organization` only checks that the user can use that organization. It does not stick for later remote calls.

## Call tools

Prefer `get_project` or `get_survey` before an edit. Do not invent API fields.

Usual project path: `create_project` → `submit_briefing_answers` → `accept_project` → `start_fielding` → `finish_fielding`.

Tools that change data refuse unless `confirm=true`.

### Scopes

| Scope | What it allows |
| --- | --- |
| `mcp:read` | List and get tools. An empty scope list is treated as read. `mcp:write` and the narrower write scopes also satisfy read. |
| `mcp:write` | `create_project`, `update_project`, `submit_briefing_answers`, `accept_project`, `archive_project`, `restore_project`. Also satisfies `mcp:fielding`, `mcp:surveys`, and `mcp:reports`. |
| `mcp:fielding` | `start_fielding`, `finish_fielding`, `get_feasibility`, `list_panel_projects` |
| `mcp:surveys` | `update_survey_structure` |
| `mcp:reports` | `list_reports`, `get_report`, `get_report_layouts`, `trigger_report_refresh` |
| `mcp:pii` | `list_respondents` with `include_pii=true`. Not granted by `mcp:write`. |

### Organizations

| Tool | What it does |
| --- | --- |
| `list_organizations` | Organizations available to the signed-in user |
| `get_organization` | Address and info for one organization domain or slug |
| `set_active_organization` | Check that the user can use an organization. Does not persist on remote calls |

### Projects

| Tool | What it does |
| --- | --- |
| `list_projects` | Projects in the organization (`limit`, `offset`, `search`) |
| `get_project` | One project by numeric id |
| `create_project` | Create a project (`name`, optional `product_slug` and `json`). `confirm=true` and `mcp:write` |
| `update_project` | Patch project fields such as name or json. `confirm=true` |
| `get_briefing` | Read flattened briefing answers |
| `submit_briefing_answers` | Write briefing answers onto the project. `confirm=true` |
| `accept_project` | Accept an offer and spawn the survey. Optional `product_slug` and `answers`. `confirm=true` |
| `start_fielding` | Start collection for an accepted project. `confirm=true` and `mcp:fielding` |
| `finish_fielding` | Finish a project that is collecting. `confirm=true` and `mcp:fielding` |
| `archive_project` | Archive a project. `confirm=true` |
| `restore_project` | Restore an archived project. `confirm=true` |

### Surveys

| Tool | What it does |
| --- | --- |
| `list_surveys` | Surveys in the organization |
| `get_survey` | One survey by uuid |
| `update_survey_structure` | Patch only `name`, `json`, `survey_template_uuid`, and `id`. `confirm=true` and `mcp:surveys` |
| `get_survey_statistics` | Statistics for a project uuid |
| `list_respondents` | Status, timing, quota, and furthest question. Personal data stays redacted unless `include_pii=true` and the token has `mcp:pii` |

### Panels

These calls use deeptrue admin routes. A non-admin gets 403, and the tool reports that refusal. Both require `mcp:fielding`. Providers are `cint`, `bilendi`, and `dynata`.

| Tool | What it does |
| --- | --- |
| `get_feasibility` | Status snapshot. Default provider `cint` (`cint` and `dynata` use status; `bilendi` uses projects) |
| `list_panel_projects` | Cint demands or audit, Bilendi projects or audit, or Dynata projects or audit. Default is Cint demands, otherwise projects. Allowed resources: Cint `demands`, `audit`, `target-groups`; Bilendi `projects`, `audit`; Dynata `projects`, `audit` |

### Reports

| Tool | What it does |
| --- | --- |
| `list_reports` | Report files for the organization. Requires `mcp:reports` |
| `get_report` | One report file by id. Requires `mcp:reports` |
| `get_report_layouts` | Layouts for audience `org` (default) or `admin` |
| `trigger_report_refresh` | Save a report HTML snapshot. deeptrue admins only. `confirm=true`. A 403 means nothing was saved |

## Debug config

Check in this order:

1. Local command: Node.js is 20.9 or newer, and `DEEPTRUE_API_KEY` is set to a `dt_…` value. `DEEPTRUE_API_BASE`, when set, overrides the default origin `https://api.deeptrue.ch`.
2. Missing credentials: `Missing credentials. Set DEEPTRUE_API_KEY for stdio, or send Authorization / X-DeepTrue-Api-Key for HTTP.`
3. Session exchange: `POST https://api.deeptrue.ch/v1/auth/mcp/session/` with `{"api_key":"dt_…"}` or `{"access_token":"<oauth bearer>"}`. `MCP session exchange failed (401)` means the key or token was rejected.
4. Write refused: `Refusing <tool>: pass confirm=true to proceed.` Pass `confirm=true` only when the user asked to change data.
5. Scope refused: `Missing required scope: …` or `Missing mcp:read scope`. `include_pii=true` also needs `mcp:pii`.
6. Survey patch refused: allowed fields are only `id`, `name`, `json`, and `survey_template_uuid`.
7. Panel or admin report 403: the account is not a deeptrue admin. The call did not succeed and nothing was saved.
8. Remote reachability: `GET https://mcp.deeptrue.ch/healthz` returns `{ "ok": true, "service": "deeptrue-mcp" }`.
9. ChatGPT given a `dt_…` key: remove it and complete OAuth. A `dt_` bearer is an API key, which ChatGPT remote connectors must not use.
