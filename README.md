# @rainmakerho/jira-easy-mcp

[![npm version](https://img.shields.io/npm/v/%40rainmakerho%2Fjira-easy-mcp.svg)](https://www.npmjs.com/package/@rainmakerho/jira-easy-mcp)
[![GitHub](https://img.shields.io/github/license/rainmakerho/jira-easy-mcp)](https://github.com/rainmakerho/jira-easy-mcp)

Another Model Context Protocol (MCP) server for Jira, without Auth token. Provides tools for complete Jira automation including issues, projects, boards, sprints, comments, worklogs, and more.

> **Tested on:** Jira Server v7.12.3 (self-hosted)

---

## 🔑 Why This MCP?

**Works with Basic Authentication (username + password)** — no API tokens required!

Most Jira MCP servers require OAuth or API tokens, which many organizations restrict or don't allow. This MCP uses **HTTP Basic Authentication**, so you can connect using just your Jira username and password. Perfect for:

- 🏢 **Enterprise environments** where admins don't allow API token creation
- 🔒 **Self-hosted Jira Server** instances without OAuth configured
- ⚡ **Quick setup** without going through IT approval processes

---

## Quick Start

### Store Jira Credentials

Store credentials in the operating system account that will run the MCP server:

**macOS (Keychain):**

```bash
security add-generic-password -s "JiraMCP" -a "YOUR_USERID" -w "YOUR_PASSWORD" -U
```

**Windows (Credential Manager):**

```powershell
cmdkey /generic:JiraMCP /user:YOUR_USERID /pass:YOUR_PASSWORD
```

The MCP server reads credentials from a Windows **Generic Credential** with target `JiraMCP`. `cmdkey /add` creates a Windows/Domain credential, whose password is not available to this application. If you already created a `JiraMCP` entry with `/add`, remove that entry in Credential Manager, then create it with `/generic` as shown above. If multiple macOS entries use the service, set `JIRA_USERNAME` to select the matching account. For older installations, setting both `JIRA_USERNAME` and `JIRA_PASSWORD` remains a fallback when no matching system credential is available.

> **Security note:** These commands may leave the password in shell history or briefly expose it in process arguments. Use your shell's secure input or credential-entry method where available.

### VS Code (Workspace Configuration)

Create `.vscode/mcp.json` in your workspace root:

```json
{
  "servers": {
    "jira": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@rainmakerho/jira-easy-mcp@latest"],
      "env": {
        "JIRA_BASE_URL": "https://your-jira-instance.com",
        "JIRA_PROJECTS_FILTER": "ABC,DEF,XYZ",
        "JIRA_RESPONSE_FORMAT": "JSON"
      }
    }
  }
}
```

Add to your VS Code settings for accessing in all workspaces.

> **Note:** `JIRA_PROJECTS_FILTER` and `JIRA_RESPONSE_FORMAT` are optional. Projects filter limits access to specified projects. Response format can be `JSON` (default) or `TOON` (text-oriented notation).

### Other IDEs

**Cursor:** Manually add the configuration above to your Cursor settings(use `"mcp": { "servers": { ... } }` wrapper)  
**Windsurf:** Add to your Windsurf MCP settings: (use `"mcp": { "servers": { ... } }` wrapper)  
**Claude Desktop:** Edit `~/.claude/mcp.json` (use `"mcpServers": { ... }` wrapper)

All use the same `command`, `args`, and non-secret `env` configuration as VS Code above. Credentials are read from the operating system credential store; do not add them to the IDE configuration.

---

## Common Use Cases

| Task                    | Tool                       | Example Prompt                                                          |
| ----------------------- | -------------------------- | ----------------------------------------------------------------------- |
| **Search issues**       | `jira_search`              | "Search for all open bugs assigned to me in project ABC"                |
| **Get issue details**   | `jira_get_issue`           | "Show me the details of issue ABC-123"                                  |
| **Create issue**        | `jira_create_issue`        | "Create a new bug in project ABC with title 'Login button not working'" |
| **Update issue**        | `jira_update_issue`        | "Change the priority of ABC-123 to High and assign it to john.doe"      |
| **Upload attachment**   | `jira_upload_attachment`   | "Upload `/tmp/error-screenshot.png` to ABC-123"                         |
| **Add comment**         | `jira_add_comment`         | "Add a comment to ABC-123 saying 'Fix deployed to staging'"             |
| **Change status**       | `jira_transition_issue`    | "Move ABC-123 to Done"                                                  |
| **Log time**            | `jira_add_worklog`         | "Log 2 hours of work on ABC-123 for yesterday"                          |
| **List projects**       | `jira_get_projects`        | "Show me all projects I have access to"                                 |
| **View sprints**        | `jira_get_sprints`         | "What's in the current sprint for project ABC?"                         |
| **Link issues**         | `jira_create_link`         | "Link ABC-123 as blocking ABC-124"                                      |
| **Generate filter URL** | `jira_generate_filter_url` | "Create a shareable link for all open bugs updated in the last 7 days"  |

---

## Uploading Attachments

Use `jira_create_issue` to create an issue, then call `jira_upload_attachment` with the returned issue key and an absolute path to a local file:

```json
{
  "issueKey": "ABC-123",
  "filePath": "/tmp/error-screenshot.png"
}
```

The MCP server reads the file from the machine where it runs. Any file type is supported. Jira Server enforces the final attachment size and permission limits.

---

## Testing with MCP Inspector

The MCP Inspector provides a web UI to test all tools interactively:

```bash
npx @modelcontextprotocol/inspector npx @rainmakerho/jira-easy-mcp
```

This opens a browser at `http://localhost:6274` where you can:

- View all available tools
- Test each tool with custom parameters
- See the raw JSON responses

> **Note:** Set `JIRA_BASE_URL` in the Inspector environment before connecting. Credentials are read from the operating system credential store; the legacy `JIRA_USERNAME` and `JIRA_PASSWORD` fallback is also supported.

---

### Optional Environment Variables

| Variable               | Default  | Description                                     |
| ---------------------- | -------- | ----------------------------------------------- |
| `JIRA_PROJECTS_FILTER` | _(none)_ | Comma-separated project keys to limit access    |
| `JIRA_RESPONSE_FORMAT` | `JSON`   | Response format: `JSON` or `TOON`               |
| `JIRA_LOG_LEVEL`       | `INFO`   | Log verbosity: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `JIRA_TIMEOUT`         | `30000`  | Request timeout in milliseconds                 |
| `JIRA_RETRY_COUNT`     | `3`      | Number of retries for failed requests           |
| `JIRA_RETRY_DELAY`     | `1000`   | Base delay between retries (ms)                 |
| `JIRA_SSL_VERIFY`      | `true`   | Set to `false` to skip SSL verification         |
| `JIRA_CACHE_TTL`       | `300`    | Cache TTL in seconds for static data            |

---

## Compatibility

| Jira Version        | Status                           |
| ------------------- | -------------------------------- |
| Jira Server v7.12.3 | ✅ Tested                        |
| Jira Server v8.x    | ✅ Tested                        |
| Jira Cloud          | ︖ Not tested (Use official MCP) |

**You can improve this by [reporting issues](https://github.com/rainmakerho/jira-easy-mcp/issues/new/choose)**
