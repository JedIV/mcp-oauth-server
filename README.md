# Dataiku MCP OAuth Server

A Dataiku standard webapp (Flask backend) that exposes Dataiku agent tools as an [MCP](https://modelcontextprotocol.io/) server secured by OAuth 2.1. MCP clients like Claude Desktop, Claude Code, ChatGPT, and VS Code can connect, authenticate, and use your Dataiku agents as tools.

## Architecture

A single Dataiku webapp serves both the **admin UI** and the **MCP endpoint**:

```
MCP Client (Claude Desktop, etc.)
  |
  +-- POST /mcp                  -- MCP StreamableHTTP (JSON-RPC 2.0)
  +-- GET  /.well-known/...      -- OAuth discovery (PRM, OIDC, AS metadata)
  +-- POST /oauth/register       -- Dynamic Client Registration (or proxy)
  +-- GET  /oauth/authorize      -- Authorization (or redirect to external IdP)
  +-- POST /oauth/token          -- Token exchange (or proxy)

Admin (Dataiku UI iframe)
  +-- GET/POST /admin/config     -- Server config (agent, base_url)
  +-- GET/POST /admin/presets    -- OAuth preset CRUD
  +-- DELETE   /admin/presets/<key>
  +-- POST     /admin/presets/<key>/activate
  +-- GET      /admin/agents     -- List available agent tools
  +-- POST     /admin/discover   -- OIDC endpoint auto-discovery
  +-- GET      /admin/health     -- Health check
```

## OAuth Modes

The webapp supports three OAuth modes, configured as **presets** that can be saved, switched, and reused:

| Mode | Use Case | How It Works |
|------|----------|-------------|
| **Built-in** | Testing & development | Self-contained OAuth server with `admin/admin` credentials |
| **External IdP (Proxy)** | Entra ID, Okta, Auth0, etc. | Proxies DCR + auth for IdPs that don't natively support MCP's DCR flow |
| **Direct OAuth 2.1** | Keycloak, etc. | Standards-compliant server with DCR; we just validate tokens via introspection |

## Files

This repo contains the four source files that make up the Dataiku standard webapp:

| File | Description |
|------|-------------|
| `params.python` | Flask backend — MCP protocol, OAuth proxy, token validation, admin API, preset management |
| `params.html` | Admin UI markup — tabs for Connection Info, OAuth Presets, Server Config |
| `params.js` | Admin UI logic — preset CRUD, agent tool loading, health display |
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

Config is stored in project variables under `mcp_oauth_config`:

```json
{
  "active_preset": "entra-prod",
  "base_url": "https://...",
  "agent": { "project_key": "MCP_WITH_OAUTH", "tool_ids": ["ysAhcfA"] },
  "presets": {
    "builtin-test": {
      "name": "Built-in (Testing)",
      "oauth_mode": "builtin",
      "oauth_enabled": true
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
  }
}
```

## Key Design Decisions

- **Flask** (not FastAPI) — works with Dataiku's built-in webapp framework
- **OAuth proxy pattern** — for IdPs like Entra ID that don't support MCP's Dynamic Client Registration, the webapp acts as a proxy: OIDC discovery points to self, `/oauth/*` endpoints forward to the external IdP while shimming in DCR support
- **JWT validation without PyJWT** — stdlib `base64` decode + claims check. Safe because we proxy the token exchange ourselves, so the token provenance is trusted
- **Config in project variables** — no external database needed; presets persist across restarts
- **Admin auth via Dataiku session** — admin endpoints check for DSS session cookies, `X-DKU-AuthenticatedUser` header, or API key

## Gotchas

- Dataiku wraps webapp JS in an IIFE — all functions must be assigned to `window` for `onclick` handlers to work
- Entra ID rejects the `resource` parameter (RFC 8707) when scopes are present — the proxy strips it
- Claude Desktop uses its own client_id for refresh token requests (different from the DCR client_id)
- The Dataiku webapp proxy strips the `Referer` header but forwards cookies — auth checks use `dss_access_token_` in Cookie as the reliable signal
