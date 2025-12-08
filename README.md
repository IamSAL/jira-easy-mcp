# jira-browser-mcp

A Model Context Protocol (MCP) server that provides Jira integration through browser automation using Playwright. This approach allows you to access Jira without API tokens by using your existing browser session.

## Features

- **Browser-based authentication**: Login once in the browser, and the session is persisted for future use
- **JQL Search**: Search for Jira issues using JQL queries
- **Issue Details**: Get detailed information about specific Jira issues
- **No API tokens required**: Uses browser automation instead of REST API

## Installation

```bash
npm install -g jira-browser-mcp
```

Or use with npx:

```bash
npx jira-browser-mcp
```

## Configuration

Set the following environment variables:

```bash
export JIRA_BASE_URL="https://your-domain.atlassian.net"
export JIRA_USERNAME="your-username"
export JIRA_PASSWORD="your-password"
```

## Usage with Claude Desktop

Add to your Claude Desktop configuration (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "jira-browser-mcp"],
      "env": {
        "JIRA_BASE_URL": "https://your-domain.atlassian.net"
      }
    }
  }
}
```

## Usage with VS Code

Add to your VS Code MCP settings:

```json
{
  "mcp": {
    "servers": {
      "jira": {
        "command": "npx",
        "args": ["-y", "jira-browser-mcp"],
        "env": {
          "JIRA_BASE_URL": "https://your-domain.atlassian.net"
        }
      }
    }
  }
}
```

## Available Tools

### jira_search_issues

Search for Jira issues using JQL.

**Parameters:**
- `jql` (required): JQL query string (e.g., "project = PROJ AND status = Open")
- `maxResults` (optional): Maximum number of results to return (default: 50)

**Example:**
```
Search for open bugs in project MYPROJ assigned to me
```

### jira_get_issue

Get detailed information about a specific Jira issue.

**Parameters:**
- `issueKey` (required): The issue key (e.g., PROJ-123)

**Example:**
```
Get details for issue MYPROJ-456
```

## First-Time Setup

1. On first run, a browser window will open
2. Log in to your Jira instance manually
3. The session will be saved to `~/.jira-mcp-browser-data/`
4. Subsequent runs will use the saved session

## Development

```bash
# Clone the repository
git clone https://github.com/your-username/jira-browser-mcp.git
cd jira-browser-mcp

# Install dependencies
pnpm install

# Build
pnpm build

# Run locally
JIRA_BASE_URL="https://your-domain.atlassian.net" pnpm start
```

## License

ISC
