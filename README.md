# jira-basic-mcp

[![npm version](https://img.shields.io/npm/v/jira-basic-mcp.svg)](https://www.npmjs.com/package/jira-basic-mcp)
[![GitHub](https://img.shields.io/github/license/IamSAL/jira-basic-mcp)](https://github.com/IamSAL/jira-basic-mcp)

A comprehensive Model Context Protocol (MCP) server for Jira integration. Provides **38 tools** for complete Jira automation including issues, projects, boards, sprints, comments, worklogs, and more.

> **Tested on:** Jira Server v7.12.3 (self-hosted) and Jira Cloud

---

## 🔑 Why This MCP?

**Works with Basic Authentication (username + password)** — no API tokens required!

Most Jira MCP servers require OAuth or API tokens, which many organizations restrict or don't allow. This MCP uses **HTTP Basic Authentication**, so you can connect using just your Jira username and password. Perfect for:

- 🏢 **Enterprise environments** where admins don't allow API token creation
- 🔒 **Self-hosted Jira Server** instances without OAuth configured
- ⚡ **Quick setup** without going through IT approval processes
- 🌐 **Jira Cloud** (also works with API tokens if you prefer)

---

## Features

- 🔐 **Basic Authentication** — Just username/password, no tokens needed
- 🔍 **JQL Search** — Powerful issue search with full JQL support
- 📋 **Issue Management** — Create, read, update, delete issues
- 💬 **Comments** — Add, edit, delete comments with wiki markup
- 🔄 **Workflows** — View and perform issue transitions
- 📊 **Boards & Sprints** — Agile board and sprint management
- ⏱️ **Worklogs** — Time tracking and work log management
- 🔗 **Issue Links** — Create relationships between issues
- 👥 **Users** — Search and lookup user information
- 🏗️ **Projects** — List projects, issue types, and metadata

---

## Quick Start

### 1. Installation

```bash
npm install -g jira-mcp
```

Or use directly with npx (no install needed):

```bash
npx jira-mcp
```

### 2. Get Your Credentials

**For Jira Server (self-hosted):**

- Username: Your Jira username
- Password: Your regular Jira password

**For Jira Cloud:**

- Username: Your email address
- Password: Your password OR an [API token](https://id.atlassian.com/manage-profile/security/api-tokens)

---

## Usage with VS Code

### Option 1: Workspace Configuration (Recommended)

Create `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://your-jira-instance.com",
        "JIRA_USERNAME": "your-username",
        "JIRA_PASSWORD": "your-password"
      }
    }
  }
}
```

### Option 2: User Settings

Add to your VS Code `settings.json`:

```json
{
  "mcp": {
    "servers": {
      "jira": {
        "command": "npx",
        "args": ["-y", "jira-mcp"],
        "env": {
          "JIRA_BASE_URL": "https://your-jira-instance.com",
          "JIRA_USERNAME": "your-username",
          "JIRA_PASSWORD": "your-password"
        }
      }
    }
  }
}
```

### Using in VS Code

Once configured, you can ask GitHub Copilot things like:

- *"Search for all open bugs in project ABC"*
- *"Show me the details of issue ABC-123"*
- *"Add a comment to ABC-123 saying the fix is ready for review"*
- *"Transition ABC-123 to Done"*
- *"Create a new bug in project ABC with title 'Login button not working'"*
- *"What issues are assigned to me?"*
- *"Show me the current sprint for project ABC"*

---

## Usage with Claude Desktop

Add to your config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://your-jira-instance.com",
        "JIRA_USERNAME": "your-username",
        "JIRA_PASSWORD": "your-password"
      }
    }
  }
}
```

---

## Standalone Usage

#### Note: Required Environment Variables

```bash
export JIRA_BASE_URL="https://your-jira-instance.com"
export JIRA_USERNAME="your-username"
export JIRA_PASSWORD="your-password"

npx jira-mcp
```

### Testing with MCP Inspector

The MCP Inspector provides a web UI to test all tools interactively:

```bash
npx @modelcontextprotocol/inspector npx jira-mcp
```

This opens a browser at `http://localhost:6274` where you can:

- View all 38 available tools
- Test each tool with custom parameters
- See the raw JSON responses

---

## Available Tools (38 Total)

### Issues (6 tools)


| Tool                 | Description                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `jira_search`        | Search issues using JQL. Supports complex queries like`project = ABC AND status = Open AND assignee = currentUser()` |
| `jira_get_issue`     | Get complete issue details including all fields, comments, and attachments                                           |
| `jira_create_issue`  | Create a new issue. Use`jira_get_create_meta` first to discover required fields                                      |
| `jira_update_issue`  | Update any field on an existing issue                                                                                |
| `jira_delete_issue`  | Permanently delete an issue (use with caution!)                                                                      |
| `jira_get_changelog` | Get the complete change history of an issue                                                                          |

### Comments (4 tools)


| Tool                  | Description                                                                 |
| ----------------------- | ----------------------------------------------------------------------------- |
| `jira_get_comments`   | Get all comments on an issue                                                |
| `jira_add_comment`    | Add a comment. Supports wiki markup:`*bold*`, `_italic_`, `{code}...{code}` |
| `jira_update_comment` | Edit an existing comment                                                    |
| `jira_delete_comment` | Delete a comment                                                            |

### Transitions (2 tools)


| Tool                    | Description                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `jira_get_transitions`  | Get available workflow transitions (e.g., "To Do" → "In Progress" → "Done")         |
| `jira_transition_issue` | Move issue to a new status. Get valid transition IDs from`jira_get_transitions` first |

### Projects (4 tools)


| Tool                   | Description                                                            |
| ------------------------ | ------------------------------------------------------------------------ |
| `jira_get_projects`    | List all accessible projects with keys and names                       |
| `jira_get_project`     | Get detailed project information including lead, components, versions  |
| `jira_get_issue_types` | Get available issue types for a project (Epic, Story, Task, Bug, etc.) |
| `jira_get_create_meta` | Get required and optional fields for creating issues in a project      |

### Boards (2 tools)


| Tool              | Description                                                  |
| ------------------- | -------------------------------------------------------------- |
| `jira_get_boards` | List Scrum and Kanban boards, optionally filtered by project |
| `jira_get_board`  | Get board details including type and configuration           |

### Sprints (5 tools)


| Tool                     | Description                                           |
| -------------------------- | ------------------------------------------------------- |
| `jira_get_sprints`       | List all sprints for a board (active, closed, future) |
| `jira_get_sprint`        | Get sprint details including start/end dates and goal |
| `jira_get_sprint_issues` | Get all issues in a specific sprint                   |
| `jira_create_sprint`     | Create a new sprint                                   |
| `jira_update_sprint`     | Update sprint name, dates, goal, or state             |

### Worklogs (3 tools)


| Tool                  | Description                                     |
| ----------------------- | ------------------------------------------------- |
| `jira_get_worklogs`   | Get all work logs for an issue                  |
| `jira_add_worklog`    | Log time spent. Formats:`2h`, `30m`, `1d`, `1w` |
| `jira_delete_worklog` | Delete a work log entry                         |

### Issue Links (5 tools)


| Tool                      | Description                                                 |
| --------------------------- | ------------------------------------------------------------- |
| `jira_get_link_types`     | Get available link types (Blocks, Clones, Relates to, etc.) |
| `jira_create_link`        | Create a link between two issues                            |
| `jira_delete_link`        | Remove an issue link                                        |
| `jira_get_remote_links`   | Get external links (URLs) attached to an issue              |
| `jira_create_remote_link` | Add an external URL link to an issue                        |

### Users (4 tools)


| Tool                        | Description                                          |
| ----------------------------- | ------------------------------------------------------ |
| `jira_get_myself`           | Get the currently authenticated user's profile       |
| `jira_search_users`         | Search for users by name or email                    |
| `jira_get_user`             | Get detailed user profile by account ID              |
| `jira_get_assignable_users` | Get users who can be assigned to issues in a project |

### Fields (3 tools)


| Tool                     | Description                                               |
| -------------------------- | ----------------------------------------------------------- |
| `jira_get_fields`        | Get all available fields (system and custom)              |
| `jira_get_field`         | Get details for a specific field including allowed values |
| `jira_get_field_options` | Get dropdown options for select/multiselect fields        |

---

## Common Use Cases

### Search Examples (JQL)

```sql
# Find my open issues
assignee = currentUser() AND status != Done

# Find bugs created this week
project = ABC AND type = Bug AND created >= startOfWeek()

# Find issues updated recently
project = ABC AND updated >= -7d ORDER BY updated DESC

# Find unassigned high priority issues
project = ABC AND assignee is EMPTY AND priority = High
```

### Create Issue Example

First, discover required fields:

```text
Tool: jira_get_create_meta
Parameters: { "projectKey": "ABC", "issueTypeName": "Bug" }
```

Then create the issue:

```text
Tool: jira_create_issue
Parameters: {
  "projectKey": "ABC",
  "issueType": "Bug",
  "summary": "Login button not working on mobile",
  "description": "Users cannot tap the login button on iOS devices.",
  "priority": "High",
  "labels": ["mobile", "ios"]
}
```

### Transition Issue Example

First, get available transitions:

```text
Tool: jira_get_transitions
Parameters: { "issueKey": "ABC-123" }
# Returns: [{ id: "31", name: "Done" }, { id: "21", name: "In Progress" }]
```

Then transition:

```text
Tool: jira_transition_issue
Parameters: {
  "issueKey": "ABC-123",
  "transitionId": "31",
  "comment": "Fixed in PR #456"
}
```

---

## Development

```bash
# Clone the repository
git clone <repo-url>
cd jira-mcp

# Install dependencies
pnpm install

# Build
pnpm build

# Run in development mode (watch for changes)
pnpm dev

# Run the server
pnpm start
```

---

## Troubleshooting

### "401 Unauthorized"

- ✅ Check username and password are correct
- ✅ For Jira Cloud, you may need an API token instead of password
- ✅ Verify the base URL is correct (no trailing slash)

### "403 Forbidden"

- ✅ Your account may lack permission for that resource
- ✅ CAPTCHA may be triggered — log in via browser to reset

### CAPTCHA Triggered

If login fails multiple times, Jira may require CAPTCHA:

1. Log into Jira via your web browser
2. Complete the CAPTCHA challenge
3. Try the API again

### Connection Issues

- ✅ Ensure JIRA_BASE_URL uses `https://`
- ✅ Check for VPN/firewall requirements
- ✅ Test with: `curl -u "user:pass" "https://your-jira/rest/api/2/myself"`

---

## Compatibility


| Jira Version        | Status         |
| --------------------- | ---------------- |
| Jira Server v7.12.3 | ✅ Tested      |
| Jira Server v8.x    | ✅ Should work |
| Jira Server v9.x    | ✅ Should work |
| Jira Cloud          | ✅ Supported   |

---

## License

ISC
