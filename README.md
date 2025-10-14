
# Neon Local Connect your IDE Extension

Connect any app to any Neon branch over localhost, and manage your database directly from your IDE. Browse schemas, run queries, and edit table data - all without leaving your IDE. Built on Docker-based [Neon Local](https://github.com/neondatabase-labs/neon_local) with a powerful database management interface.

## ✨ Features

- **Database Visualization**: Browse your database schema with an intuitive tree view showing databases, schemas, tables, columns, and relationships
- **Migrations & Queries View**: Automatically discover and execute SQL migrations and queries from your project
- **ORM Integration**: Visual ORM model and migration management with schema drift detection for Django and Prisma
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
- **Branch Management**: Create and connect to Neon branches using a local connection string without leaving your IDE
- **Ephemeral Workflows**: Easily incorporate ephemeral Neon branches into your local development and testing workflows
- **Multiple Query Options**: Query your database using the built-in SQL editor, terminal, or via the Neon console
- **Driver Support**: Supports both Postgres and Neon serverless drivers
- **Container Management**: The extension manages a Neon Local Docker container for you, no manual Docker commands required

## 📋 Requirements

- Docker must be installed and running
- your IDE 1.85.0 or later
- A [Neon account](https://neon.tech)

## 🚀 Quick start

### 1. **Install the extension**

Find "Neon Local Connect" in the your IDE Marketplace and click **Install**.

### 2. **Sign in to Neon**
Open the Neon Local Connect panel in the sidebar (look for the Neon logo).

Click **Sign in**

![sign in with your Neon account](/resources/sign-in.png)

OAuth sign in will ask to launch authentication in an external browser.


![neon OAuth authorization in browser](/resources/authorize.png)

You can also import a Neon API key to make it so that you don't need to resign into the extension after closing your IDE. All auth tokens or API keys are securely stored and encrypted by the extension.

### 3. **Connect to a branch**

You have two main choices:

- **Existing branch:**  
  Use this if you want to connect to a long-lived branch (like `main`, `development`, or a feature branch) that you or your team will use repeatedly. This is best for ongoing development, team collaboration, or when you want your changes to persist.

  ![persistent branch connected](/resources/connected.png)

- **Ephemeral branch:**  
  Choose this for a temporary, disposable branch that's created just for your current development session. Perfect for testing, experiments, or CI runs. Your branch (and any changes) will be automatically deleted when you disconnect.

   ![ephemeral branch connected](/resources/ephemeral_connected.png)


### 4. **Use the static connection string**

After connecting, you can find your local connection string in the extension panel. Copy the connection string, update it with your database name, and then add it to your app's `.env` or config. The local connection string will not change as you switch between branches:

![Local connection details](/resources/connection_string.png)

Example `.env`:

```env
DATABASE_URL="postgres://neon:npg@localhost:5432/neondb"
```

The local connection string can support both traditional postgres connections and connections using the Neon serverless driver.

### 5. **Run your app**

Your app now talks to Neon via `localhost:5432`. No code changes needed when you switch branches!

**Example:**

```js
// Node.js example using pg or @neondatabase/serverless
const { Client } = require('pg'); // or require('@neondatabase/serverless')
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
```

or

```bash
psql $DATABASE_URL
```

## 🗂️ Database Schema View

Once connected, the extension provides a comprehensive **Database Schema** view in the sidebar that lets you explore your database structure visually:

![Database Schema View](/resources/database_schema_view.png)

### What you can see:
- **Databases**: All available databases in your connected branch
- **Schemas**: Database schemas organized in a tree structure  
- **Tables & Views**: All tables and views with their column definitions
- **Data Types**: Column data types, constraints, and relationships
- **Primary Keys**: Clearly marked primary key columns
- **Foreign Keys**: Visual indicators for foreign key relationships

### What you can do:
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

The schema view automatically updates when you switch between branches, so you always see the current state of your connected database.

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

### How to use:
1. **From Schema View**: Right-click any table and select "Query Table" for a pre-filled SELECT query
2. **From Actions Panel**: Click "Open SQL Editor" to start with a blank query
3. **From Command Palette**: Use `Ctrl+Shift+P` and search for "Neon: Open SQL Editor"

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

### How to access:
1. **From Schema View**: Right-click any table and select "View Table Data"
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

### How to access:
1. **Create Index**: Right-click any table → "Create Index"
2. **Manage Indexes**: Right-click any table → "Manage Indexes"
3. Configure index settings and preview SQL
4. Monitor and optimize database performance

Perfect for performance tuning, query optimization, and ensuring efficient database operations.

## 🚀 Migrations & Queries View

Automatically discover and execute SQL migrations and queries from your project. The extension scans your workspace for migration files and SQL scripts, allowing you to execute them directly.

### Supported Frameworks & Patterns:
- **Knex**: `migrations/*.{js,ts,sql}`
- **Sequelize**: `migrations/*.{js,ts}`
- **TypeORM**: `migration/*.{js,ts}`
- **Prisma**: `prisma/migrations/*/*.sql`
- **Flyway**: `db/migration/*.sql`
- **Liquibase**: `db/changelog/*.{sql,xml,json,yaml}`
- **Rails**: `db/migrate/*.{rb,sql}`
- **Laravel**: `database/migrations/*.{php,sql}`
- **Django**: `migrations/*.py`
- **Generic SQL**: `queries/*.sql`, `sql/*.sql`, `scripts/*.sql`
- **Seeds**: `seeds/*.{sql,js,ts}`, `seeders/*.{sql,js,ts}`

### Features:
- **Auto-Discovery**: Automatically finds migration files in your project
- **Smart Filtering**: Excludes generated files and build artifacts automatically
- **Execute Single File**: Run individual migration files with one click
- **Batch Execution**: Execute all migrations in a folder sequentially
- **SQL Preview**: Preview SQL before execution
- **Framework Detection**: Identifies migration framework automatically
- **Real-time Updates**: Watches for new migration files
- **Safety Confirmations**: Prompts before executing destructive operations

### How to use:
1. Open the **Migrations & Queries** view in the Neon Local Connect sidebar
2. The extension automatically scans for migration files in your workspace
3. **Execute Single Migration**: Right-click a `.sql` file → "Execute Migration"
4. **Execute All Migrations**: Right-click a folder → "Execute All Migrations"
5. **Open File**: Click any file to view its contents
6. Use the refresh button if you add new migration files

### Framework-Specific Support:

**Django Migrations** (✨ Native Support):
- Right-click a Django migrations folder → "Execute All Migrations"
- Extension automatically detects `manage.py` and runs migrations with proper Python interpreter
- **Smart venv detection**: Automatically finds and uses your virtual environment's Python
  - Checks VS Code's Python extension settings first
  - Searches for `venv/`, `.venv/`, `env/`, `virtualenv/` directories
  - Falls back to system Python if no venv found
  - Works on Windows (`Scripts/python.exe`) and Unix (`bin/python`)
- Option to run migrations for specific app or all apps
- Connection string automatically passed via `DATABASE_URL` environment variable
- Terminal output shows which Python interpreter is being used

**Other Frameworks**:
For TypeScript, JavaScript, Ruby, PHP migrations, use the appropriate CLI tool:
- **Knex**: `npx knex migrate:latest`
- **Sequelize**: `npx sequelize-cli db:migrate`
- **TypeORM**: `npx typeorm migration:run`
- **Prisma**: `npx prisma migrate deploy`
- **Rails**: `rails db:migrate`
- **Laravel**: `php artisan migrate`

## 🎯 ORM Integration

Get a comprehensive view of your ORM models and migrations directly in VS Code. The extension automatically detects Django and Prisma projects and provides visual management tools with real-time schema drift detection.

### Key Features:

**📦 Visual Model Tree**:
- Browse all your ORM models organized by app (Django) or schema (Prisma)
- See real-time sync status for each model:
  - ✅ **Green**: Model synced with database
  - ⚠️ **Yellow**: Schema has changes (drift detected)
  - ❌ **Red**: Table doesn't exist in database yet
- Click any model to open its definition file
- View table directly in database schema panel

**🗄️ Migration Tracking**:
- Visual list of all migrations with applied/pending status
- ✅ Applied migrations show green checkmark
- ⏳ Pending migrations show yellow clock
- Click to open migration files
- Grouped by app for easy navigation

**⚡ Quick Actions**:
- **Django**:
  - Make Migrations (`python manage.py makemigrations`)
  - Run All Migrations (`python manage.py migrate`)
  - Open Django Shell
  - Test Database
  - Generate Model from Table
- **Prisma**:
  - Pull Schema from DB (`prisma db pull`)
  - Push Schema to DB (`prisma db push`)
  - Open Prisma Studio
  - Generate Client
  - Validate Schema
  - Migrate Dev/Deploy

**🔍 Schema Drift Detection**:
- Automatically compares model definitions with actual database tables
- Detects missing fields (in model but not in DB)
- Detects extra fields (in DB but not in model)
- Visual indicators show which models need attention
- Helps prevent schema inconsistencies before deployment

### Supported ORMs:

**Django** (Full Support):
- Parses all `models.py` files in your project
- Detects apps and model classes automatically
- Supports custom table names (`Meta.db_table`)
- Tracks migrations from `django_migrations` table
- Smart virtual environment detection

**Prisma** (Full Support):
- Parses `schema.prisma` file
- Detects all models and fields
- Supports custom table names (`@@map`)
- Tracks migrations from `_prisma_migrations` table
- Direct integration with Prisma CLI

**Coming Soon**: TypeORM, Sequelize, Rails ActiveRecord, Laravel Eloquent

### How to Use:

1. **Open ORM Panel**: Click the Neon logo in sidebar, then expand "ORM" section
2. **Browse Models**: Expand "Models" to see all your ORM models
3. **Check Status**: Look for visual indicators (green/yellow/red)
4. **View Migrations**: Expand "Migrations" to see applied/pending migrations
5. **Quick Actions**: Use "Quick Actions" for common ORM commands
6. **Context Menu**: Right-click models for actions like "View Table in Database"

### Example Workflow:

1. Edit your Django model to add a new field
2. Extension detects change and shows ⚠️ yellow indicator
3. Click "Make Migrations" in Quick Actions
4. New migration appears in Migrations section with ⏳ pending status
5. Click "Run All Migrations" to apply
6. Model turns ✅ green, migration shows ✓ applied

This tight integration keeps your models and database in perfect sync!

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

### How to access:
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

### How to use:
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

## 🖱️ Panel actions

Once connected, the Neon Local Connect panel provides quick access to common database operations:

### Branch Management:
- **Reset from Parent Branch:** Instantly reset your branch to match its parent's state  
  [Docs: Branch reset](https://neon.com/docs/guides/reset-from-parent)

### Database Tools (available in the main panel):
- **Open SQL Editor (Browser):** Launch the Neon SQL Editor in your browser for advanced queries  
  [Docs: SQL Editor](https://neon.com/docs/get-started-with-neon/query-with-neon-sql-editor)
- **Open Table View (Browser):** Browse your database schema and data in the Neon Console  
  [Docs: Tables](https://neon.com/docs/guides/tables)
- **Launch PSQL:** Open a psql shell in the integrated terminal for direct SQL access  
  [Docs: Using psql with Neon](https://neon.com/docs/connect/query-with-psql-editor)

### Built-in Database Tools (new in your IDE):
- **Database Schema View:** Explore your database structure in the sidebar with expandable tree view
- **Built-in SQL Editor:** Write and execute queries directly in your IDE with results display
- **Table Data Editor:** View and edit table data with a spreadsheet-like interface
- **Context Menus:** Right-click databases, tables, and views for quick actions like querying and data management

## 💡 Why this matters

- **Unified Development Experience**: Manage your database schema, run queries, and edit data without leaving your IDE
- **No Dynamic Connection Strings**: Just use `localhost:5432` everywhere, no matter which branch you're on
- **Visual Database Management**: See your database structure at a glance and interact with it through intuitive UI
- **Faster Development Cycles**: Query, test, and modify data instantly without switching between tools
- **Branch-Aware Workflows**: Switch branches for features, tests, or teammates without touching your app code
- **Universal Compatibility**: Works with any language or framework that supports Postgres
- **Powered by Neon Local**: All the power of [Neon Local](https://github.com/neondatabase-labs/neon_local) with an enhanced your IDE UI

## 🛠️ Troubleshooting

- Docker must be running for the extension to work.
- If you see "connection refused," check that Docker is running and port 5432 is available.

## 📚 Learn more

- [Neon Docs](https://neon.tech/docs/)
- [Neon Local Documentation](https://neon.tech/docs/local/neon-local)
- [Neon Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)
- [Community & Support](https://discord.gg/92vNTzKDGp)
- [Neon Local Example React Express App](https://github.com/neondatabase-labs/neon-local-example-react-express-application)


## 📄 License

This extension is released under the [MIT License](LICENSE).
