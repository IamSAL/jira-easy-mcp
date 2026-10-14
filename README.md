# jira-easy-mcp

[![npm version](https://img.shields.io/npm/v/jira-easy-mcp.svg)](https://www.npmjs.com/package/jira-easy-mcp)
[![GitHub](https://img.shields.io/github/license/IamSAL/jira-easy-mcp)](https://github.com/IamSAL/jira-easy-mcp)

Another Model Context Protocol (MCP) server for Jira, without Auth token. Provides tools for complete Jira automation including issues, projects, boards, sprints, comments, worklogs, and more.

> **Tested on:** Jira Server / Data Center 7.13, 8.20, 9.12 and 10.3 (every tool, automated, see [Development & Testing](#development--testing))

---

## 🔑 Why This MCP?

**Works with Basic Authentication (username + password)** — no API tokens required!

Most Jira MCP servers require OAuth or API tokens, which many organizations restrict or don't allow. This MCP uses **HTTP Basic Authentication**, so you can connect using just your Jira username and password. Perfect for:

- 🏢 **Enterprise environments** where admins don't allow API token creation
- 🔒 **Self-hosted Jira Server** instances without OAuth configured
- ⚡ **Quick setup** without going through IT approval processes


---

## Quick Start

### VS Code (Workspace Configuration)

Create `.vscode/mcp.json` in your workspace root:

```json
{
  "servers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "jira-easy-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://your-jira-instance.com",
        "JIRA_USERNAME": "your-username",
        "JIRA_PASSWORD": "your-password",
        "JIRA_PROJECTS_FILTER": "ABC,DEF,XYZ",
        "JIRA_RESPONSE_FORMAT": "JSON"
      }
    }
  }
}
```
Add to your VS Code settings for accessing in all workspaces.

> **Note:** `JIRA_PROJECTS_FILTER` and `JIRA_RESPONSE_FORMAT` are optional. Projects filter limits access to specified projects. Response format can be `JSON` (default) or `TOON` (text-oriented notation).

### Claude Code

```bash
claude mcp add jira \
  -e JIRA_BASE_URL=https://your-jira-instance.com \
  -e JIRA_USERNAME=your-username \
  -e JIRA_PASSWORD=your-password \
  -- npx -y jira-easy-mcp
```

### Codex CLI

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.jira]
command = "npx"
args = ["-y", "jira-easy-mcp"]
env = { JIRA_BASE_URL = "https://your-jira-instance.com", JIRA_USERNAME = "your-username", JIRA_PASSWORD = "your-password" }
```

### Other clients

**Cursor:** `~/.cursor/mcp.json` or `.cursor/mcp.json` (use `"mcpServers": { ... }` wrapper)  
**Windsurf:** Add to your Windsurf MCP settings (use `"mcpServers": { ... }` wrapper)  
**Claude Desktop:** Edit `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`; use `"mcpServers": { ... }` wrapper)  
**Gemini CLI:** `~/.gemini/settings.json` (use `"mcpServers": { ... }` wrapper)

All use the same `command`, `args`, and `env` configuration as VS Code above.

> **Windows:** if the client cannot start `npx`, use `"command": "cmd"` with `"args": ["/c", "npx", "-y", "jira-easy-mcp"]`.
>
> **Tool limits:** some clients (notably Cursor) cap how many tools they send to the model, historically around 40 across all servers. This server has 41; turn off the ones you don't need in the client's MCP settings.

### Credentials from the OS keychain (optional)

To keep your password out of config files, omit `JIRA_USERNAME`/`JIRA_PASSWORD` and store a credential under the service name `JiraMCP`:

- **macOS:** `security add-generic-password -s JiraMCP -a your-username -w` (prompts for the password; on first start macOS asks to allow `node` to read it)
- **Windows:** `cmdkey /generic:JiraMCP /user:your-username /pass` (use `/generic`, not `/add`)

If several accounts are stored, set `JIRA_USERNAME` to choose one. When both `JIRA_USERNAME` and `JIRA_PASSWORD` are set, they are used and the keychain is not read. Keychain support uses the optional `keytar` package; if it can't be installed on your machine, use the environment variables.


---

## Common Use Cases

| Task | Tool | Example Prompt |
| --- | --- | --- |
| **Search issues** | `jira_search` | "Search for all open bugs assigned to me in project ABC" |
| **Get issue details** | `jira_get_issue` | "Show me the details of issue ABC-123" |
| **View issue images** | `jira_get_issue_images` | "Show me the screenshots attached to ABC-123" |
| **Upload attachment** | `jira_upload_attachment` | "Attach /Users/me/Desktop/error.png to ABC-123" |
| **Create issue** | `jira_create_issue` | "Create a new bug in project ABC with title 'Login button not working'" |
| **Update issue** | `jira_update_issue` | "Change the priority of ABC-123 to High and assign it to john.doe" |
| **Add comment** | `jira_add_comment` | "Add a comment to ABC-123 saying 'Fix deployed to staging'" |
| **Change status** | `jira_transition_issue` | "Move ABC-123 to Done" |
| **Log time** | `jira_add_worklog` | "Log 2 hours of work on ABC-123 for yesterday" |
| **List projects** | `jira_get_projects` | "Show me all projects I have access to" |
| **View sprints** | `jira_get_sprints` | "What's in the current sprint for project ABC?" |
| **Link issues** | `jira_create_link` | "Link ABC-123 as blocking ABC-124" |
| **Generate filter URL** | `jira_generate_filter_url` | "Create a shareable link for all open bugs updated in the last 7 days" |

---

## Testing with MCP Inspector

The MCP Inspector provides a web UI to test all tools interactively:

```bash
npx @modelcontextprotocol/inspector npx jira-easy-mcp
```

This opens a browser at `http://localhost:6274` where you can:

- View all available tools
- Test each tool with custom parameters
- See the raw JSON responses

> **Note:** Put these values inside inspector UI before connecting: `JIRA_BASE_URL`, `JIRA_USERNAME`, `JIRA_PASSWORD`.

---

### Optional Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `JIRA_PROJECTS_FILTER` | *(none)* | Comma-separated project keys. Tools reject issue/project keys outside the list (issue IDs must be given as keys) and JQL is scoped to these projects. Board, sprint and link IDs are not checked |
| `JIRA_RESPONSE_FORMAT` | `JSON` | Response format: `JSON` or `TOON` |
| `JIRA_LOG_LEVEL` | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `JIRA_TIMEOUT` | `30000` | Request timeout in milliseconds |
| `JIRA_RETRY_COUNT` | `3` | Retries for timeouts, 429 and 502-504. Write requests (POST) are only retried on 429, so a slow Jira never gets duplicate issues, comments or links |
| `JIRA_RETRY_DELAY` | `1000` | Base delay between retries (ms) |
| `JIRA_SSL_VERIFY` | `true` | Set to `false` to skip SSL verification. For a company CA, prefer `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` |
| `JIRA_CACHE_TTL` | `300` | Cache TTL in seconds for static data |

`jira_get_issue_images` downloads images through Jira's authenticated attachment URLs
(`/secure/attachment/...`, Jira Server/Data Center). It returns up to five images by
default (maximum ten), with a 10 MiB limit per image and 20 MiB per response.
`jira_upload_attachment` reads a local file by absolute path on the machine running the server.

---

## Development & Testing

```bash
pnpm install
pnpm test              # unit tests + build (any OS, Node 18+)
node scripts/smoke.mjs # MCP handshake check (needs JIRA_BASE_URL set to anything)
```

**Against a real Jira** (Docker, Node 20.10+): the helper starts a throwaway Jira, completes setup with
Atlassian's public [3-hour timebomb license](https://developer.atlassian.com/platform/marketplace/timebomb-licenses-for-testing-server-apps/),
and seeds an admin (`admin` / `Jira-IT-admin-1`), a second user, and two Scrum projects (`IT`, `OT`).

```bash
pnpm jira:up 9.12 8080            # or 7.13, 8.20, 10.3 (Jira 10 also starts PostgreSQL)
JIRA_IT_BASE_URL=http://localhost:8080 pnpm test:integration
pnpm jira:down 9.12
```

`pnpm jira:up 9.12 8080 /jira` serves Jira under a context path. Each instance needs about 3 GB of
Docker memory; run one at a time on small machines. The keychain tests only run where `keytar`
works and no real `JiraMCP` credential exists, and they remove what they create.
CI runs the unit tests on Linux, macOS and Windows (Node 18-24) and the integration suite against every
version above.

---

## Compatibility

| Jira Version | Status |
| --- | --- |
| Jira Server 7.12.3 | ✅ Tested manually |
| Jira Server 7.13 | ✅ Automated (all tools) |
| Jira Server / DC 8.20 | ✅ Automated (all tools) |
| Jira DC 9.12 (also under a `/jira` context path) | ✅ Automated (all tools) |
| Jira DC 10.3 | ✅ Automated (all tools) |
| Jira Cloud | ︖ Not tested (Use official MCP) |

Requires Node.js 18+. CI runs the unit and MCP smoke tests on macOS, Linux and Windows (Node.js 18–24).

**You can improve this by [reporting issues](https://github.com/IamSAL/jira-easy-mcp/issues/new/choose)**

