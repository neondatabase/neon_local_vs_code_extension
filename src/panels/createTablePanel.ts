import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';

export interface ColumnDefinition {
    name: string;
    dataType: string;
    length?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    isUnique: boolean;
    comment?: string;
}

export interface TableDefinition {
    schema: string;
    tableName: string;
    owner?: string;
    columns: ColumnDefinition[];
}

export class CreateTablePanel {
    public static currentPanel: CreateTablePanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        database?: string
    ) {
        // If we already have a panel, show it
        if (CreateTablePanel.currentPanel) {
            CreateTablePanel.currentPanel.panel.reveal();
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'createTable',
            'Create Table',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        CreateTablePanel.currentPanel = new CreateTablePanel(panel, context, stateService, schema, database);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schema: string,
        private database?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        // Load initial data and set HTML
        this.loadInitialData();
    }

    private async loadInitialData() {
        try {
            const sqlService = new SqlQueryService(this.stateService, this.context);
            
            // Get roles from database (excluding system roles and neon-specific roles)
            const rolesQuery = `
                SELECT rolname 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%' 
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser', 'neon_service')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `;
            const rolesResult = await sqlService.executeQuery(rolesQuery, this.database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery('SELECT current_user', this.database);
            const currentUser = currentUserResult.rows[0]?.current_user || '';

            // Set HTML with initial data
            this.panel.webview.html = this.getWebviewContent(existingRoles, currentUser);
        } catch (error) {
            console.error('Failed to load initial data:', error);
            // Set HTML with empty data
            this.panel.webview.html = this.getWebviewContent([], '');
        }
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'createTable':
                await this.createTable(message.tableDefinition);
                break;

            case 'previewSql':
                const sql = this.generateCreateTableSql(message.tableDefinition);
                this.sendMessage({
                    command: 'sqlPreview',
                    sql
                });
                break;

            case 'cancel':
                this.panel.dispose();
                break;
        }
    }

    /**
     * Quote a PostgreSQL identifier to preserve case and handle special characters
     */
    private quoteIdentifier(identifier: string): string {
        // Escape any double quotes by doubling them
        const escaped = identifier.replace(/"/g, '""');
        // Wrap in double quotes
        return `"${escaped}"`;
    }

    private generateCreateTableSql(tableDef: TableDefinition): string {
        const { schema, tableName, columns, owner } = tableDef;
        
        if (!tableName || columns.length === 0) {
            return '-- Invalid table definition';
        }

        let sql = `CREATE TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(tableName)} (\n`;
        
        const columnDefs: string[] = [];
        const constraints: string[] = [];

        // Generate column definitions
        columns.forEach((col, index) => {
            if (!col.name || !col.dataType) {
                return;
            }

            let colDef = `    ${this.quoteIdentifier(col.name)} ${col.dataType.toUpperCase()}`;
            
            // Add length/precision for types that support it
            if (col.length && (
                col.dataType.toLowerCase().includes('varchar') ||
                col.dataType.toLowerCase().includes('char') ||
                col.dataType.toLowerCase().includes('decimal') ||
                col.dataType.toLowerCase().includes('numeric')
            )) {
                colDef += `(${col.length})`;
            }

            // Add NOT NULL constraint
            if (!col.nullable) {
                colDef += ' NOT NULL';
            }

            // Add DEFAULT value
            if (col.defaultValue) {
                colDef += ` DEFAULT ${col.defaultValue}`;
            }

            // Add UNIQUE constraint
            if (col.isUnique && !col.isPrimaryKey) {
                colDef += ' UNIQUE';
            }

            columnDefs.push(colDef);

            // Track primary keys for constraint
            if (col.isPrimaryKey) {
                constraints.push(this.quoteIdentifier(col.name));
            }
        });

        sql += columnDefs.join(',\n');

        // Add primary key constraint
        if (constraints.length > 0) {
            sql += `,\n    PRIMARY KEY (${constraints.join(', ')})`;
        }

        sql += '\n);';

        // Add column comments if any
        columns.forEach(col => {
            if (col.comment) {
                sql += `\n\nCOMMENT ON COLUMN ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(tableName)}.${this.quoteIdentifier(col.name)} IS '${col.comment.replace(/'/g, "''")}';`;
            }
        });

        // Add owner if specified
        if (owner) {
            sql += `\n\nALTER TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(tableName)} OWNER TO "${owner}";`;
        }

        return sql;
    }

    private async createTable(tableDef: TableDefinition) {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            const sql = this.generateCreateTableSql(tableDef);
            const sqlService = new SqlQueryService(this.stateService, this.context);
            
            await sqlService.executeQuery(sql, this.database);

            vscode.window.showInformationMessage(`Table "${tableDef.schema}.${tableDef.tableName}" created successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
            // Close the panel
            this.panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to create table: ${errorMessage}`);
            this.sendMessage({
                command: 'error',
                error: errorMessage
            });
        } finally {
            this.sendMessage({ command: 'loading', loading: false });
        }
    }

    private sendMessage(message: any) {
        this.panel.webview.postMessage(message);
    }

    private extractErrorMessage(error: any): string {
        // Handle PostgreSQL error objects
        if (error && typeof error === 'object' && 'message' in error) {
            return error.message;
        }
        // Handle Error instances
        if (error instanceof Error) {
            return error.message;
        }
        // Handle string errors
        if (typeof error === 'string') {
            return error;
        }
        // Fallback: try to stringify
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    private getWebviewContent(existingRoles: string[], currentUser: string): string {
        const initialData = {
            schema: this.schema,
            database: this.database,
            existingRoles,
            currentUser
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Table</title>
    <style>
        body { 
            margin: 0; 
            padding: 0;
            height: 100vh; 
            overflow: auto; 
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'createTable.js'))}"></script>
</body>
</html>`;
    }

    public dispose() {
        CreateTablePanel.currentPanel = undefined;
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
