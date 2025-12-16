
# Neon - Serverless Postgres IDE Extension

Connect to any Neon branch and manage your database directly from your IDE. Browse schemas, run queries, edit table data, and get connection strings for your app—all without leaving your editor. Plus, automatic MCP server configuration enables seamless AI-powered database interactions with your coding agent.

## ✨ Features

- **Branch Connection**: Connect to any Neon branch and get the connection string to add to your app's `.env` file
- **AI Agent Integration**: Automatically configures the Neon MCP server for enhanced AI coding assistant integration
- **Connection String Detection**: Automatically detects Neon connection strings in your workspace and shows which branches your app is connected to
- **Database Visualization**: Browse your database schema with an intuitive tree view showing databases, schemas, tables, columns, and relationships
- **Database Management**: Professional-grade PostgreSQL management tools including:
  - **Database Operations**: Create and drop databases with full control
  - **Schema Management**: Create, rename, and manage database schemas
  - **Table Management**: Create and edit tables with visual designer
  - **Index Management**: Create and optimize indexes (B-tree, GIN, GiST, BRIN, etc.)
  - **Foreign Key Management**: Create and manage foreign key constraints with referential integrity
  - **Trigger Management**: Create, view, enable/disable, and manage database triggers
  - **View Management**: Create and manage regular and materialized views
  - **Function Management**: Create and manage functions and stored procedures (PL/pgSQL, SQL, etc.)
  - **Sequence Management**: Create and manage sequences for auto-incrementing values
  - **User & Permission Management**: Create users, drop users, change passwords, manage roles, and control permissions
  - **Data Import/Export**: Import from CSV/JSON files, export to CSV/JSON/SQL
- **Built-in SQL Editor**: Write and execute SQL queries directly in your IDE with syntax highlighting, results display, and export capabilities  
- **Table Data Management**: View, edit, insert, and delete table data with a spreadsheet-like interface without leaving your IDE
- **Multiple Query Options**: Query your database using the built-in SQL editor, terminal, or via the Neon console

## 📋 Requirements

- VS Code or Cursor 1.85.0 or later
- A [Neon account](https://neon.tech)

## 🚀 Quick Start

### 1. **Install the Extension**

Find "Neon - Serverless Postgres" in the VS Code/Cursor Marketplace and click **Install**.

### 2. **Sign in to Neon**

Open the Neon - Serverless Postgres panel in the sidebar (look for the Neon logo).

Click **Sign in**

![sign in with your Neon account](/resources/sign-in.png)

OAuth sign in will ask to launch authentication in an external browser.

![neon OAuth authorization in browser](/resources/authorize.png)

Once signed in, the extension automatically configures the **Neon MCP server** for your IDE, enabling AI-powered database features with your coding agent.

### 3. **Connect to a Branch**

The extension automatically scans your workspace for existing Neon connection strings and shows which branches your app is connected to. You can also manually select an organization, project, and branch to connect to.

Select your **Organization**, **Project**, and **Branch** from the dropdowns, then click **Connect**.

![branch connection](/resources/connected.png)

### 4. **Get Your Connection String**

After connecting, copy the connection string from the extension panel and add it to your app's `.env` file:

![Connection string](/resources/connection_string.png)

Example `.env`:

```env
DATABASE_URL="postgresql://user:password@ep-example-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

### 5. **Run Your App**

Your app now connects directly to your Neon branch. When you need to switch branches, just select a different branch in the extension and update your connection string.

**Example:**

```js
// Node.js example using pg or @neondatabase/serverless
const { Client } = require('pg'); // or require('@neondatabase/serverless')
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
```

## 🤖 AI Agent Integration (MCP Server)

The extension automatically configures the **Neon MCP (Model Context Protocol) server** when you sign in, enabling powerful AI-assisted database features:

- **Chat with your database**: Ask your AI coding assistant questions about your database schema, data, and queries
- **AI-powered SQL generation**: Let your coding agent help write complex SQL queries
- **Schema understanding**: Your AI assistant can understand your database structure and provide contextual help
- **Automatic configuration**: No manual setup required—the MCP server is configured automatically

The MCP server status is visible in the extension panel, where you can also manually enable or disable it if needed.

## 🗂️ Databases View

Once connected, the extension provides a comprehensive **Databases** view in the sidebar that lets you explore your database structure visually:

![Database Schema View](/resources/database_schema_view.png)

### What You Can See:
- **Databases**: All available databases in your connected branch
- **Schemas**: Database schemas organized in a tree structure  
- **Tables & Views**: All tables and views with their column definitions
- **Data Types**: Column data types, constraints, and relationships
- **Primary Keys**: Clearly marked primary key columns
- **Foreign Keys**: Visual indicators for foreign key relationships

### What You Can Do:
- **Right-click the connection** to:
  - **Create Database**: Create a new database with full control over encoding and templates
- **Right-click any database** to:
  - **Create Schema**: Create a new schema namespace
  - **Drop Database**: Delete the database with safety confirmations
  - **Manage Users & Roles**: View all database users and roles
  - **Create User/Role**: Create new users or roles with privileges
  - **Drop User/Role**: Remove users and roles
  - **Change Password**: Update user passwords securely
  - **Manage Permissions**: GRANT and REVOKE permissions on objects
- **Right-click any table** to access quick actions:
  - **Query Table**: Opens a pre-filled `SELECT *` query in the SQL Editor
  - **View Table Data**: Opens the table data in an editable spreadsheet view
  - **Create Index**: Visual interface for creating database indexes (B-tree, GIN, GiST, etc.)
  - **Manage Indexes**: View, drop, and reindex operations
  - **Create Foreign Key**: Define foreign key constraints with referential actions
  - **Create Trigger**: Define triggers with events, timing, and functions
  - **Import Data**: Import CSV or JSON files into the table
  - **Export Data**: Export table data to CSV, JSON, or SQL
  - **Edit Table Schema**: Modify table structure, add/remove columns
  - **Truncate Table**: Remove all rows from a table
  - **Drop Table**: Delete the table entirely
- **Right-click any foreign key** to:
  - **View Properties**: See constraint details, column mappings, and referential actions
  - **Drop Foreign Key**: Remove the constraint
- **Right-click any trigger** to:
  - **View Properties**: See trigger definition, events, timing, and function
  - **Enable Trigger**: Activate a disabled trigger
  - **Disable Trigger**: Temporarily deactivate a trigger without dropping it
  - **Drop Trigger**: Remove the trigger
- **Right-click any view** to access view operations:
  - **Edit View**: Modify view SQL definition
  - **View Properties**: See metadata, columns, and dependencies
  - **Drop View**: Remove view with CASCADE or RESTRICT
  - **Refresh Materialized View**: Update materialized view data
- **Right-click any sequence** to:
  - **Sequence Properties**: View current value, increment, limits
  - **Alter Sequence**: Modify increment, min/max, cycle behavior
  - **Drop Sequence**: Delete the sequence
- **Right-click schemas** to create tables, views, functions, sequences, and manage schema properties
- **Refresh** the schema view to see the latest structural changes
- **Expand/collapse** database objects to focus on what you need

The Databases view automatically updates when you switch between branches, so you always see the current state of your connected database.

## ⚡ Built-in SQL Editor

Execute SQL queries directly in your IDE with the integrated SQL Editor:

![SQL Editor in your IDE](/resources/sql_editor_view.png)

### Features:
- **Syntax Highlighting**: Full SQL syntax support with intelligent highlighting
- **Query Execution**: Run queries with `Ctrl+Enter` or the Execute button
- **Results Display**: View query results in a tabular format with:
  - Column sorting and filtering
  - Export to CSV/JSON formats
  - Performance statistics (execution time, rows affected, etc.)
  - Error highlighting with detailed messages
- **Query History**: Access your previous queries
- **Database Context**: Automatically connects to the selected database

### How to Use:
1. **From Databases View**: Right-click any table and select "Query Table" for a pre-filled SELECT query
2. **From Command Palette**: Use `Ctrl+Shift+P` and search for "Neon: Open SQL Editor"

The SQL Editor integrates seamlessly with your database connection, so you can query any database in your current branch without additional setup.

## 📊 Table Data Management

View and edit your table data with a powerful, spreadsheet-like interface:

![Table Data Editor](/resources/table_data_view.png)

### Viewing Data:
- **Paginated Display**: Navigate through large datasets with page controls
- **Column Management**: Show/hide columns, sort by any column
- **Data Types**: Visual indicators for different data types (primary keys, foreign keys, etc.)
- **Null Handling**: Clear visualization of NULL values

### Editing Capabilities:
- **Row Editing**: Double-click any row to edit all fields inline (requires primary key)
- **Insert New Rows**: Add new records with the "Add Row" button
- **Delete Rows**: Remove records with confirmation dialogs (requires primary key)
- **Batch Operations**: Edit multiple fields before saving changes
- **Data Validation**: Real-time validation based on column types and constraints

> **Note**: Row editing and deletion require tables to have a primary key defined. This ensures data integrity by uniquely identifying rows for safe updates.

### How to Access:
1. **From Databases View**: Right-click any table and select "View Table Data"
2. The data opens in a new tab with full editing capabilities
3. Changes are immediately applied to your database
4. Use the refresh button to see updates from other sources

Perfect for quick data inspection, testing, and small data modifications without writing SQL.

## 🎯 Index Management

Optimize your database performance with comprehensive index management tools:

![Index Management](/resources/index_management.png)

### Creating Indexes:
- **Visual Index Builder**: Create indexes without writing SQL
- **All PostgreSQL Index Types**: 
  - B-tree (default, most common)
  - GIN (full-text search, JSONB)
  - GiST (geometric data, full-text)
  - BRIN (very large tables)
  - Hash (equality comparisons)
  - SP-GiST (partitioned data)
- **Multi-Column Indexes**: Select columns in order for composite indexes
- **Unique Indexes**: Enforce uniqueness constraints
- **Partial Indexes**: Index subsets with WHERE clauses
- **Concurrent Creation**: Non-blocking index creation for production
- **SQL Preview**: See generated SQL before execution

### Managing Indexes:
- **View All Indexes**: See all indexes on a table with types and definitions
- **Drop Indexes**: Remove unused indexes (with concurrent option)
- **Reindex Operations**: Rebuild indexes to reclaim space
- **Index Statistics**: View primary keys and unique constraints
- **Safety Features**: Protection against dropping primary keys

### How to Access:
1. **Create Index**: Right-click any table → "Create Index"
2. **Manage Indexes**: Right-click any table → "Manage Indexes"
3. Configure index settings and preview SQL
4. Monitor and optimize database performance

Perfect for performance tuning, query optimization, and ensuring efficient database operations.

## 👁️ View Management

Create and manage PostgreSQL views to simplify complex queries and improve code organization:

![View Management](/resources/view_management.png)

### Creating Views:
- **Visual View Builder**: Create views without complex SQL knowledge
- **Regular Views**: Virtual tables, always show current data
- **Materialized Views**: Physical storage for faster queries
- **SQL Editor**: Multi-line SQL editor with table reference
- **Replace if Exists**: Update existing views safely
- **SQL Preview**: See generated SQL before execution

### View Types:
- **Regular Views**
  - No storage overhead
  - Always current data
  - Query executed on access
  - Best for frequently changing data
  
- **Materialized Views**
  - Physical data storage
  - Much faster queries
  - Must be refreshed
  - Best for complex aggregations and reports

### Managing Views:
- **Edit View**: Modify view definitions
- **View Properties**: Display metadata, columns, and dependencies
- **Drop View**: Remove with CASCADE or RESTRICT options
- **Refresh Materialized View**: Update data with concurrent option
- **Dependencies**: See which tables/views a view depends on

### How to Access:
1. **Create View**: Right-click Schema/Database → "Create View"
2. **Edit View**: Right-click View → "Edit View"
3. **View Properties**: Right-click View → "View Properties"
4. **Refresh**: Right-click Materialized View → "Refresh Materialized View"

Perfect for simplifying complex queries, creating data abstractions, and building efficient reporting layers.

## 📤 Data Import/Export

Import and export data easily with support for multiple formats:

![Data Import/Export](/resources/import_export.png)

### Import Features:
- **CSV Import**: Import comma-separated value files
- **JSON Import**: Import JSON data arrays
- **Column Mapping**: Automatic column detection
- **Data Preview**: Preview file contents before import
- **Batch Processing**: Efficient import of large datasets
- **Progress Tracking**: Real-time progress indicator
- **Options**:
  - Skip first row (headers)
  - Custom delimiters (comma, semicolon, tab, pipe)
  - Quote character configuration
  - NULL value handling
  - Truncate table before import

### Export Features:
- **CSV Export**: Export to comma-separated values
- **JSON Export**: Export as JSON array
- **SQL Export**: Generate INSERT statements
- **Custom Queries**: Export results from custom SQL
- **Options**:
  - Include/exclude headers
  - Custom delimiters
  - Quote character configuration
  - NULL value representation

### How to Use:
1. **Import**: Right-click Table → "Import Data"
   - Select file (CSV or JSON)
   - Preview data
   - Configure options
   - Import with progress tracking

2. **Export**: Right-click Table → "Export Data"
   - Choose format (CSV, JSON, or SQL)
   - Select destination
   - Optionally provide custom SQL query
   - Export instantly

Perfect for migrating data, seeding databases, backing up table data, and integrating with external systems.

## 💡 Why Neon - Serverless Postgres?

- **Unified Development Experience**: Manage your database schema, run queries, and edit data without leaving your IDE
- **AI-Powered Workflows**: Automatic MCP server configuration enables your coding agent to understand and work with your database
- **Visual Database Management**: See your database structure at a glance and interact with it through intuitive UI
- **Faster Development Cycles**: Query, test, and modify data instantly without switching between tools
- **Branch-Aware Workflows**: Easily switch between Neon branches for features, tests, or different environments
- **Connection String Management**: Get connection strings for any branch directly from your IDE

## 🛠️ Troubleshooting

- If you see connection errors, verify your Neon account is active and you have access to the selected project
- Check the MCP Server panel to ensure AI features are properly configured
- Use the refresh button to update the Databases view after making changes outside the extension

## 📚 Learn More

- [Neon Docs](https://neon.tech/docs/)
- [Neon Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)
- [Neon MCP Server](https://neon.tech/docs/ai/neon-mcp-server)
- [Community & Support](https://discord.gg/92vNTzKDGp)

## 📄 License

This extension is released under the [MIT License](LICENSE).
