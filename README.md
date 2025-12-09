# jira-basic-mcp

[![npm version](https://img.shields.io/npm/v/jira-basic-mcp.svg)](https://www.npmjs.com/package/jira-basic-mcp)
[![GitHub](https://img.shields.io/github/license/IamSAL/jira-basic-mcp)](https://github.com/IamSAL/jira-basic-mcp)

A comprehensive Model Context Protocol (MCP) server for Jira integration. Provides **38 tools** for complete Jira automation including issues, projects, boards, sprints, comments, worklogs, and more.

> **Tested on:** Jira Server v7.12.3 (self-hosted)

---

## 🔑 Why This MCP?

**Works with Basic Authentication (username + password)** — no API tokens required!

Most Jira MCP servers require OAuth or API tokens, which many organizations restrict or don't allow. This MCP uses **HTTP Basic Authentication**, so you can connect using just your Jira username and password. Perfect for:

- 🏢 **Enterprise environments** where admins don't allow API token creation
- 🔒 **Self-hosted Jira Server** instances without OAuth configured
- ⚡ **Quick setup** without going through IT approval processes

---

## Common Use Cases

| Task | Tool | Example Prompt |
| --- | --- | --- |
| **Search issues** | `jira_search` | "Search for all open bugs assigned to me in project ABC" |
| **Get issue details** | `jira_get_issue` | "Show me the details of issue ABC-123" |
| **Create issue** | `jira_create_issue` | "Create a new bug in project ABC with title 'Login button not working'" |
| **Update issue** | `jira_update_issue` | "Change the priority of ABC-123 to High and assign it to john.doe" |
| **Add comment** | `jira_add_comment` | "Add a comment to ABC-123 saying 'Fix deployed to staging'" |
| **Change status** | `jira_transition_issue` | "Move ABC-123 to Done" |
| **Log time** | `jira_add_worklog` | "Log 2 hours of work on ABC-123 for yesterday" |
| **List projects** | `jira_get_projects` | "Show me all projects I have access to" |
| **View sprints** | `jira_get_sprints` | "What's in the current sprint for project ABC?" |
| **Link issues** | `jira_create_link` | "Link ABC-123 as blocking ABC-124" |

---

## Quick Start

### Get Required Values

- URL: Your Jira instance domain
- Username: Your Jira username
- Password: Your regular Jira password

---

## Usage with IDE (cursor, github copilot)

### Example: VS Code Workspace Configuration (Recommended)

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-basic-mcp"],
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

> **Note:** `JIRA_PROJECTS_FILTER` and `JIRA_RESPONSE_FORMAT` are optional. Projects filter limits access to specified projects. Response format can be `JSON` (default) or `TOON` (text-oriented notation).

---

## Testing with MCP Inspector

The MCP Inspector provides a web UI to test all tools interactively:

```bash
npx @modelcontextprotocol/inspector npx jira-basic-mcp
```

This opens a browser at `http://localhost:6274` where you can:

- View all 38 available tools
- Test each tool with custom parameters
- See the raw JSON responses

> **Note:** Put these values inside inspector UI before connecting: `JIRA_BASE_URL`, `JIRA_USERNAME`, `JIRA_PASSWORD`.

---

### Optional Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `JIRA_PROJECTS_FILTER` | *(none)* | Comma-separated project keys to limit access |
| `JIRA_RESPONSE_FORMAT` | `JSON` | Response format: `JSON` or `TOON` |
| `JIRA_LOG_LEVEL` | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `JIRA_TIMEOUT` | `30000` | Request timeout in milliseconds |
| `JIRA_RETRY_COUNT` | `3` | Number of retries for failed requests |
| `JIRA_RETRY_DELAY` | `1000` | Base delay between retries (ms) |
| `JIRA_SSL_VERIFY` | `true` | Set to `false` to skip SSL verification |
| `JIRA_CACHE_TTL` | `300` | Cache TTL in seconds for static data |

---

## Compatibility

| Jira Version | Status |
| --- | --- |
| Jira Server v7.12.3 | ✅ Tested |
| Jira Server v8.x | ✅ Should work |
| Jira Server v9.x | ✅ Should work |
| Jira Cloud | ✅ Should work |

---

## License

ISC
