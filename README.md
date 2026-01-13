# Neon - Serverless Postgres

Connect to any Neon branch and manage your database directly in your IDE. Browse schemas, run queries, edit table data, and get connection strings—all without leaving your editor.

![Branch Connection](/resources/connected.png)

## Features

### Branch Connection
- Connect to any Neon project and branch
- Automatic detection of Neon connection strings in your workspace
- One-click connection string copying for your `.env` file

![Branch Connection](/resources/Branch_detected.png)

### Database Explorer
Browse your database structure with an intuitive tree view:
- Databases, schemas, tables, views, and sequences
- Column definitions with data types and constraints
- Primary key and foreign key indicators
- One-click actions for common operations

![Database Schema View](/resources/database_schema_view.png)

### Database Management
Professional-grade PostgreSQL management tools:
- Create and drop databases and schemas
- Table designer with column, index, and constraint management
- Foreign key management with referential integrity
- View and sequence management
- User and role management
- Data import/export (CSV, JSON, SQL)

### SQL Editor
Execute SQL queries directly in your IDE:
- Syntax highlighting
- Results in tabular format with sorting and filtering
- Export to CSV, JSON, or SQL
- Query execution statistics

![SQL Editor](/resources/updated_sql_editor.png)

### Table Data Editor
View and edit data with a spreadsheet-like interface:
- Paginated display for large datasets
- Inline editing, insert, and delete operations
- Column visibility and sorting controls
- Real-time data validation

![Table Data View](/resources/updated_table_view.png)

### AI Agent Integration
- **Automatic MCP Server configuration** — enables AI-powered database features with your coding agent
- Chat with your database using natural language
- AI-assisted SQL generation and schema understanding
- View and manage MCP server status directly in the extension
- **Read-only mode** — restrict MCP Server to read-only operations

![MCP Server View](/resources/MCP_server.png)

To enable read-only mode: open the MCP Server panel, check "Read-only mode", and reload the window. This prevents accidental data modifications when using AI features.

## Requirements

- VS Code 1.85.0+ or Cursor
- A [Neon account](https://neon.tech)

## Getting Started

### 1. Install the Extension

Search for **"Neon - Serverless Postgres"** in the Extensions view (`Ctrl+Shift+X`) and click Install.

### 2. Sign In

1. Open the Neon panel in the sidebar (look for the Neon logo)
2. Click **Sign in**
3. Complete OAuth authorization in your browser

![Sign In](/resources/sign-in.png)

Once signed in, the extension automatically configures the Neon MCP server for AI features.

### 3. Connect to a Branch

The extension scans your workspace for existing Neon connection strings. You can also manually select:
1. **Organization** — your Neon organization
2. **Project** — the project containing your database
3. **Branch** — the branch to connect to

Click **Connect** to establish the connection.

### 4. Use Your Connection String

Copy the connection string from the extension and add it to your `.env` file:

```env
DATABASE_URL="postgresql://user:password@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

## Extension Settings

This extension contributes the following settings:

* `neon.mcpServer.autoConfigEnabled` — Automatically configure the Neon MCP server on sign-in (default: `true`)
* `neon.mcpServer.readOnlyMode` — Restrict MCP server to read-only operations (default: `false`)

## Commands

Access these commands via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `Neon: Sign In` | Sign in to your Neon account |
| `Neon: Sign Out` | Sign out from your Neon account |
| `Neon: Open SQL Editor` | Open a new SQL editor tab |
| `Neon: View Databases` | Open the database tree view |
| `Neon: Refresh Databases` | Refresh the database tree view |
| `Neon: Create Branches`  | Create Neon branches |
| `Neon: Get Started`  | Automatically configure your project to work with Neon |

## Troubleshooting

**Connection errors**
- Verify your Neon account is active
- Ensure you have access to the selected project and branch

**MCP Server not working**
- Check the MCP Server panel status
- Try disabling and re-enabling the MCP server
- Reload the window after configuration changes
- Disable read-only mode if you need write operations (INSERT, UPDATE, DELETE)

**Database view not updating**
- Use the refresh button in the Databases view title bar
- Disconnect and reconnect to the branch

## Resources

- [Neon Documentation](https://neon.tech/docs/)
- [Neon MCP Server](https://neon.tech/docs/ai/neon-mcp-server)
- [Neon Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)
- [Discord Community](https://discord.gg/92vNTzKDGp)
- [GitHub Issues](https://github.com/neondatabase/neon-local-connect/issues)

## License

[MIT License](LICENSE)
