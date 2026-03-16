# Dataiku MCP OAuth Server

A Dataiku standard webapp (Flask backend) that exposes Dataiku agent tools as [MCP](https://modelcontextprotocol.io/) servers secured by OAuth 2.1. Supports **multiple independent MCP servers**, each with their own tools and OAuth configuration. MCP clients like Claude Desktop, Claude Code, ChatGPT, and VS Code can connect, authenticate, and use your Dataiku agents as tools.

## Architecture

A single Dataiku webapp serves the **admin UI** and **multiple MCP endpoints**, one per configured server:

```
MCP Client (Claude Desktop, etc.)
  |
  +-- POST /servers/<name>/mcp                  -- MCP StreamableHTTP (JSON-RPC 2.0)
  +-- GET  /servers/<name>/.well-known/...      -- OAuth discovery (PRM, OIDC, AS metadata)
  +-- POST /servers/<name>/oauth/register       -- Dynamic Client Registration (or proxy)
  +-- GET  /servers/<name>/oauth/authorize      -- Authorization (or redirect to external IdP)
  +-- POST /servers/<name>/oauth/token          -- Token exchange (or proxy)

Admin (Dataiku UI iframe)
  +-- GET/POST /admin/config                    -- Global config
  +-- GET/POST /admin/servers                   -- Server CRUD
  +-- DELETE   /admin/servers/<name>
  +-- GET/POST /admin/presets                   -- OAuth preset CRUD
  +-- DELETE   /admin/presets/<key>
  +-- GET      /admin/agents                    -- List available agent tools
  +-- POST     /admin/discover                  -- OIDC endpoint auto-discovery
  +-- GET      /admin/health                    -- Health check (per-server status)
```

## Multiple Servers

Each server has:
- Its own **MCP endpoint** at `/servers/<name>/mcp`
- Its own **OAuth flow** (discovery, registration, authorization, token exchange)
- Its own **agent tools** (project + tool selection)
- Its own **OAuth preset** (chosen from shared presets)

This allows exposing different tool sets to different clients or teams, each with independent authentication.

## OAuth Modes

The webapp supports three OAuth modes, configured as **presets** that are shared across servers:

| Mode | Use Case | How It Works |
|------|----------|-------------|
| **Built-in** | Testing & development | Self-contained OAuth server with `admin/admin` credentials |
| **External IdP (Proxy)** | Entra ID, Okta, Auth0, etc. | Proxies DCR + auth for IdPs that don't natively support MCP's DCR flow |
| **Direct OAuth 2.1** | Keycloak, etc. | Standards-compliant server with DCR; we just validate tokens via introspection |

## Files

This repo contains the four source files that make up the Dataiku standard webapp:

| File | Description |
|------|-------------|
| `params.python` | Flask backend — MCP protocol, OAuth proxy, token validation, admin API, server + preset management |
| `params.html` | Admin UI markup — tabs for Servers and OAuth Presets |
| `params.js` | Admin UI logic — server CRUD, preset CRUD, agent tool loading, health display |
| `params.css` | Styles for the admin interface |

These files are deployed to Dataiku via the webapp settings API. They are **not** standalone — they run inside the Dataiku webapp framework, which provides the Flask `app` object, `getWebAppBackendUrl()`, and the IIFE wrapper for JS.

## Deployment

The webapp lives in Dataiku project `MCP_WITH_OAUTH`, webapp ID `ylZBBDE`.

To deploy changes:

```python
import dataiku
project = dataiku.api_client().get_project("MCP_WITH_OAUTH")
webapp = project.get_webapp("ylZBBDE")
settings = webapp.get_settings()
raw = settings.get_raw()

# Update files
for ext, key in [('python', 'python'), ('html', 'html'), ('js', 'js'), ('css', 'css')]:
    with open(f'params.{ext}') as f:
        raw['params'][key] = f.read()

settings.save()
webapp.stop_backend()
webapp.start_or_restart_backend()
```

## Configuration

Config is stored in project variables under `mcp_oauth_config` (v2 format):

```json
{
  "config_version": 2,
  "base_url": "https://...",
  "presets": {
    "builtin-test": {
      "name": "Built-in (Testing)",
      "oauth_mode": "builtin",
      "oauth_enabled": true,
      "scopes": ["mcp:tools"]
    },
    "entra-prod": {
      "name": "Entra ID - Production",
      "oauth_mode": "external",
      "oauth_enabled": true,
      "authorization_server": "https://login.microsoftonline.com/{tenant}/v2.0",
      "client_id": "...",
      "client_secret": "...",
      "scopes": ["api://.../mcp.tools"]
    }
  },
  "servers": {
    "default": {
      "display_name": "Default",
      "active_preset": "entra-prod",
      "agent": { "project_key": "MCP_WITH_OAUTH", "tool_ids": ["ysAhcfA"] }
    },
    "analytics": {
      "display_name": "Analytics Tools",
      "active_preset": "builtin-test",
      "agent": { "project_key": "ANALYTICS", "tool_ids": ["tool1"] }
    }
  }
}
```

Older config formats (v1 flat or preset-only) are automatically migrated to v2 on first load.

## Key Design Decisions

- **Flask** (not FastAPI) — works with Dataiku's built-in webapp framework
- **Multiple servers** — each server gets its own endpoint path, tools, and OAuth preset, while presets are shared globally
- **OAuth proxy pattern** — for IdPs like Entra ID that don't support MCP's Dynamic Client Registration, the webapp acts as a proxy: OIDC discovery points to self, `/oauth/*` endpoints forward to the external IdP while shimming in DCR support
- **Token validation via introspection** — external/direct mode tokens are validated server-side by calling the IdP's introspection endpoint (RFC 7662). No local JWT decode — the IdP is the authority. This prevents token forgery entirely.
- **Config in project variables** — no external database needed; config persists across restarts
- **Admin auth via API key** — admin endpoints require a valid Dataiku API key (`X-DKU-APIKey` header), validated server-side against DSS
- **Server names as URL slugs** — must be lowercase alphanumeric with hyphens, used directly in endpoint URLs

## Gotchas

- Dataiku wraps webapp JS in an IIFE — all functions must be assigned to `window` for `onclick` handlers to work
- Entra ID rejects the `resource` parameter (RFC 8707) when scopes are present — the proxy strips it
- Claude Desktop uses its own client_id for refresh token requests (different from the DCR client_id)
- The Dataiku webapp proxy strips the `Referer` header but forwards cookies — auth checks use `dss_access_token_` in Cookie as the reliable signal
- Built-in OAuth stores (clients, tokens, auth codes) are global/shared across servers — they're testing-only
