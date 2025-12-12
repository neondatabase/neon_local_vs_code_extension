import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';

export interface ColumnChange {
    action: 'add' | 'modify' | 'drop';
    oldName?: string;
    newName: string;
    dataType: string;
    length?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    isUnique: boolean;
    comment?: string;
    original?: {
        dataType: string;
        length?: number;
        nullable: boolean;
        defaultValue?: string;
        isPrimaryKey: boolean;
        isUnique: boolean;
        comment?: string;
    };
}

export interface TableSchemaEdit {
    schema: string;
    tableName: string;
    changes: ColumnChange[];
}

export class EditTablePanel {
    public static currentPanels = new Map<string, EditTablePanel>();
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ) {
        const key = `${database || 'default'}.${schema}.${tableName}`;
        
        // If we already have a panel for this table, show it
        if (EditTablePanel.currentPanels.has(key)) {
            const existingPanel = EditTablePanel.currentPanels.get(key)!;
            existingPanel.panel.reveal();
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'editTable',
            `Edit Table: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        EditTablePanel.currentPanels.set(key, new EditTablePanel(panel, context, stateService, schema, tableName, database));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schema: string,
        private tableName: string,
        private database?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getWebviewContent();

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        // Load existing table structure
        this.loadTableStructure();
    }

    private async loadTableStructure() {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            const sqlService = new SqlQueryService(this.stateService, this.context);
            const schemaService = new SchemaService(this.stateService, this.context);
            
            // Get columns
            const columns = await schemaService.getColumns(this.database || 'neondb', this.schema, this.tableName);
            
            // Get current table owner
            const ownerQuery = `
                SELECT tableowner as owner
                FROM pg_tables
                WHERE schemaname = $1 AND tablename = $2;
            `;
            const ownerResult = await sqlService.executeQuery(ownerQuery, [this.schema, this.tableName], this.database);
            const currentOwner = ownerResult.rows[0]?.owner || '';
            
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
            
            // Normalize data type from PostgreSQL format to UI format
            const normalizeDataType = (dbType: string): string => {
                const typeMap: { [key: string]: string } = {
                    'character varying': 'VARCHAR',
                    'character': 'CHAR',
                    'integer': 'INTEGER',
                    'bigint': 'BIGINT',
                    'smallint': 'SMALLINT',
                    'numeric': 'NUMERIC',
                    'decimal': 'DECIMAL',
                    'real': 'REAL',
                    'double precision': 'DOUBLE PRECISION',
                    'text': 'TEXT',
                    'boolean': 'BOOLEAN',
                    'date': 'DATE',
                    'time': 'TIME',
                    'time without time zone': 'TIME',
                    'timestamp': 'TIMESTAMP',
                    'timestamp without time zone': 'TIMESTAMP',
                    'timestamp with time zone': 'TIMESTAMPTZ',
                    'uuid': 'UUID',
                    'json': 'JSON',
                    'jsonb': 'JSONB',
                    'bytea': 'BYTEA',
                    'inet': 'INET',
                    'cidr': 'CIDR',
                    'macaddr': 'MACADDR',
                    'array': 'ARRAY',
                    'serial': 'SERIAL',
                    'bigserial': 'BIGSERIAL'
                };
                
                return typeMap[dbType.toLowerCase()] || dbType.toUpperCase();
            };

            // Transform columns to the format expected by the UI
            const columnData = columns.map((col, index) => ({
                id: index,
                name: col.name,
                originalName: col.name,
                dataType: normalizeDataType(col.metadata.data_type),
                length: col.metadata.character_maximum_length,
                nullable: col.metadata.is_nullable,
                defaultValue: col.metadata.column_default || '',
                isPrimaryKey: col.metadata.is_primary_key,
                isUnique: false, // We'd need to query indexes for this
                comment: '',
                status: 'existing' as const,
                isDeleted: false
            }));

            this.sendMessage({
                command: 'initialize',
                schema: this.schema,
                tableName: this.tableName,
                columns: columnData,
                database: this.database,
                currentOwner,
                existingRoles,
                currentUser
            });
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to load table structure: ${errorMessage}`);
            this.sendMessage({
                command: 'error',
                error: errorMessage
            });
        } finally {
            this.sendMessage({ command: 'loading', loading: false });
        }
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'applyChanges':
                await this.applyChanges(message.changes, message.tableName, message.owner);
                break;

            case 'previewSql':
                const sql = this.generateAlterTableSql(
                    message.changes, 
                    message.tableName !== message.originalTableName ? message.tableName : undefined,
                    message.owner !== message.originalOwner ? message.owner : undefined
                );
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

    private generateAlterTableSql(changes: ColumnChange[], newTableName?: string, newOwner?: string): string {
        if ((!changes || changes.length === 0) && !newTableName && !newOwner) {
            return '-- No changes to apply';
        }

        const sqlStatements: string[] = [];
        const fullTableName = `"${this.schema}"."${this.tableName}"`;

        changes.forEach(change => {
            switch (change.action) {
                case 'add':
                    let addColDef = `ALTER TABLE ${fullTableName}\n  ADD COLUMN "${change.newName}" ${change.dataType.toUpperCase()}`;
                    
                    if (change.length && (
                        change.dataType.toLowerCase().includes('varchar') ||
                        change.dataType.toLowerCase().includes('char') ||
                        change.dataType.toLowerCase().includes('decimal') ||
                        change.dataType.toLowerCase().includes('numeric')
                    )) {
                        addColDef += `(${change.length})`;
                    }

                    if (!change.nullable) {
                        addColDef += ' NOT NULL';
                    }

                    if (change.defaultValue) {
                        addColDef += ` DEFAULT ${change.defaultValue}`;
                    }

                    if (change.isUnique) {
                        addColDef += ' UNIQUE';
                    }

                    addColDef += ';';
                    sqlStatements.push(addColDef);

                    if (change.isPrimaryKey) {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ADD PRIMARY KEY ("${change.newName}");`);
                    }
                    break;

                case 'modify':
                    // Column modifications require multiple statements
                    // First, rename if name changed
                    if (change.oldName && change.oldName !== change.newName) {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  RENAME COLUMN "${change.oldName}" TO "${change.newName}";`);
                    }

                    const colName = change.newName;
                    const original = change.original || {};
                    
                    // Only change data type if it actually changed
                    const normalizeDataType = (type: string) => type?.toUpperCase().trim() || '';
                    if (normalizeDataType(change.dataType) !== normalizeDataType(original.dataType)) {
                        // SERIAL and BIGSERIAL are pseudo-types that cannot be used with ALTER COLUMN
                        // Convert them to their underlying types
                        let targetType = change.dataType.toUpperCase();
                        if (targetType === 'SERIAL') {
                            targetType = 'INTEGER';
                        } else if (targetType === 'BIGSERIAL') {
                            targetType = 'BIGINT';
                        }
                        
                        let typeChange = `ALTER TABLE ${fullTableName}\n  ALTER COLUMN "${colName}" TYPE ${targetType}`;
                        if (change.length && (
                            change.dataType.toLowerCase().includes('varchar') ||
                            change.dataType.toLowerCase().includes('char')
                        )) {
                            typeChange += `(${change.length})`;
                        }
                        typeChange += ';';
                        sqlStatements.push(typeChange);
                        
                        // Add a comment if the user tried to use SERIAL/BIGSERIAL
                        if (change.dataType.toUpperCase() === 'SERIAL' || change.dataType.toUpperCase() === 'BIGSERIAL') {
                            sqlStatements.push(`-- Note: SERIAL/BIGSERIAL cannot be used with ALTER COLUMN. Converting to ${targetType}.`);
                            sqlStatements.push(`-- To add auto-increment, create a sequence and set it as the default value.`);
                        }
                    }

                    // Only change nullable if it actually changed
                    if (change.nullable !== original.nullable) {
                        if (change.nullable) {
                            sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN "${colName}" DROP NOT NULL;`);
                        } else {
                            sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN "${colName}" SET NOT NULL;`);
                        }
                    }

                    // Only change default if it actually changed
                    const normalizeValue = (val: any) => (val === null || val === undefined || val === '') ? '' : val;
                    if (normalizeValue(change.defaultValue) !== normalizeValue(original.defaultValue)) {
                        if (change.defaultValue) {
                            sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN "${colName}" SET DEFAULT ${change.defaultValue};`);
                        } else {
                            sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN "${colName}" DROP DEFAULT;`);
                        }
                    }
                    break;

                case 'drop':
                    sqlStatements.push(`ALTER TABLE ${fullTableName}\n  DROP COLUMN "${change.oldName || change.newName}";`);
                    break;
            }

            if (change.comment) {
                sqlStatements.push(`COMMENT ON COLUMN ${fullTableName}."${change.newName}" IS '${change.comment.replace(/'/g, "''")}';`);
            }
        });

        // Handle table rename
        if (newTableName && newTableName !== this.tableName) {
            sqlStatements.push(`ALTER TABLE ${fullTableName}\n  RENAME TO "${newTableName}";`);
        }

        // Handle owner change
        if (newOwner) {
            const targetTableName = newTableName || this.tableName;
            sqlStatements.push(`ALTER TABLE "${this.schema}"."${targetTableName}"\n  OWNER TO "${newOwner}";`);
        }

        return sqlStatements.join('\n\n');
    }

    private async applyChanges(changes: ColumnChange[], newTableName?: string, newOwner?: string) {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            if ((!changes || changes.length === 0) && !newTableName && !newOwner) {
                vscode.window.showInformationMessage('No changes to apply.');
                return;
            }

            // Check for SERIAL/BIGSERIAL type changes and warn the user
            const serialChanges = changes.filter(c => 
                c.action === 'modify' && 
                (c.dataType.toUpperCase() === 'SERIAL' || c.dataType.toUpperCase() === 'BIGSERIAL')
            );
            
            if (serialChanges.length > 0) {
                const columnNames = serialChanges.map(c => c.newName).join(', ');
                const message = `Columns [${columnNames}] are being changed to SERIAL/BIGSERIAL. ` +
                    `Note: PostgreSQL doesn't support changing to SERIAL type directly. ` +
                    `The column(s) will be changed to INTEGER/BIGINT instead. ` +
                    `Do you want to continue?`;
                
                const choice = await vscode.window.showWarningMessage(
                    message,
                    { modal: true },
                    'Continue',
                    'Cancel'
                );
                
                if (choice !== 'Continue') {
                    return;
                }
            }

            const sql = this.generateAlterTableSql(changes, newTableName, newOwner);
            const sqlService = new SqlQueryService(this.stateService, this.context);
            
            // Execute all ALTER statements
            const statements = sql.split(';').filter(s => s.trim());
            for (const statement of statements) {
                if (statement.trim()) {
                    await sqlService.executeQuery(statement.trim() + ';', this.database);
                }
            }

            vscode.window.showInformationMessage(`Table "${this.schema}.${this.tableName}" updated successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
            // Close the panel
            this.panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to update table: ${errorMessage}`);
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

    private getWebviewContent(): string {
        const initialData = {
            schema: this.schema,
            tableName: this.tableName,
            columns: [],
            database: this.database,
            currentOwner: '',
            existingRoles: [],
            currentUser: ''
        };
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Table</title>
</head>
<body>
    <div id="root"></div>
    <script>
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'editTable.js'))}"></script>
</body>
</html>`;
    }

    private getKey(): string {
        return `${this.database || 'default'}.${this.schema}.${this.tableName}`;
    }

    public dispose() {
        const key = this.getKey();
        EditTablePanel.currentPanels.delete(key);
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
