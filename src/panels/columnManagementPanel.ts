import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { SqlQueryService } from '../services/sqlQuery.service';

interface ColumnDefinition {
    name: string;
    dataType: string;
    length?: number;
    precision?: number;
    scale?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey?: boolean;
    isUnique?: boolean;
}

export class ColumnManagementPanel {
    private static extractErrorMessage(error: any): string {
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

    /**
     * Create a new column
     */
    public static async createColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'createColumn',
            `Add Column to ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        const initialData = {
            schema,
            tableName,
            mode: 'create'
        };

        panel.webview.html = this.getWebviewContent(context, panel, 'createColumn', initialData);

        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'createColumn':
                        await this.executeCreateColumn(
                            context,
                            stateService,
                            schema,
                            tableName,
                            message.columnDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = this.generateCreateColumnSql(schema, tableName, message.columnDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    }

    /**
     * Edit an existing column
     */
    public static async editColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        columnName: string,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'editColumn',
            `Edit Column: ${schema}.${tableName}.${columnName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        // Fetch current column details
        try {
            const sqlService = new SqlQueryService(stateService, context);
            const result = await sqlService.executeQuery(`
                SELECT 
                    column_name,
                    data_type,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale,
                    is_nullable,
                    column_default,
                    EXISTS(
                        SELECT 1 FROM information_schema.key_column_usage kcu
                        JOIN information_schema.table_constraints tc 
                            ON kcu.constraint_name = tc.constraint_name
                            AND kcu.table_schema = tc.table_schema
                        WHERE kcu.table_schema = $1
                            AND kcu.table_name = $2
                            AND kcu.column_name = $3
                            AND tc.constraint_type = 'PRIMARY KEY'
                    ) as is_primary_key,
                    EXISTS(
                        SELECT 1 FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu 
                            ON tc.constraint_name = kcu.constraint_name
                            AND tc.table_schema = kcu.table_schema
                        WHERE tc.table_schema = $1
                            AND tc.table_name = $2
                            AND kcu.column_name = $3
                            AND tc.constraint_type = 'UNIQUE'
                    ) as is_unique
                FROM information_schema.columns
                WHERE table_schema = $1
                    AND table_name = $2
                    AND column_name = $3
            `, [schema, tableName, columnName], database);

            if (result.rows.length === 0) {
                vscode.window.showErrorMessage(`Column "${columnName}" not found in table "${schema}.${tableName}"`);
                panel.dispose();
                return;
            }

            const currentColumn = result.rows[0];
            
            const initialData = {
                schema,
                tableName,
                columnName,
                currentColumn,
                mode: 'edit'
            };

            panel.webview.html = this.getWebviewContent(context, panel, 'editColumn', initialData);

            panel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                        case 'editColumn':
                            await this.executeEditColumn(
                                context,
                                stateService,
                                schema,
                                tableName,
                                columnName,
                                message.columnDef,
                                currentColumn,
                                database,
                                panel
                            );
                            break;
                        case 'previewSql':
                            const sql = this.generateEditColumnSql(schema, tableName, columnName, message.columnDef, currentColumn);
                            panel.webview.postMessage({ command: 'sqlPreview', sql });
                            break;
                        case 'cancel':
                            panel.dispose();
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to load column details: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop a column
     */
    public static async dropColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        columnName: string,
        database?: string
    ): Promise<void> {
        try {
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop column "${columnName}" from table "${schema}.${tableName}"?`,
                { modal: true },
                'Drop Column'
            );

            if (!confirmation) {
                return;
            }

            const sql = `ALTER TABLE "${schema}"."${tableName}" DROP COLUMN "${columnName}";`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Column "${columnName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            // Improved error handling to extract meaningful error messages
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                // Handle PostgreSQL error objects
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            
            vscode.window.showErrorMessage(`Failed to drop column: ${errorMessage}`);
        }
    }

    /**
     * Execute column creation
     */
    private static async executeCreateColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        columnDef: ColumnDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = this.generateCreateColumnSql(schema, tableName, columnDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Column "${columnDef.name}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            // Improved error handling to extract meaningful error messages
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                // Handle PostgreSQL error objects
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Execute column edit
     */
    private static async executeEditColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        oldColumnName: string,
        columnDef: ColumnDefinition,
        currentColumn: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = this.generateEditColumnSql(schema, tableName, oldColumnName, columnDef, currentColumn);
            
            if (!sql || sql === '-- No changes to apply') {
                vscode.window.showInformationMessage('No changes to apply');
                panel.dispose();
                return;
            }

            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Column "${columnDef.name}" updated successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            // Improved error handling to extract meaningful error messages
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                // Handle PostgreSQL error objects
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Generate CREATE COLUMN SQL
     */
    private static generateCreateColumnSql(schema: string, tableName: string, columnDef: ColumnDefinition): string {
        const statements: string[] = [];

        // Build column definition
        let columnSpec = `"${columnDef.name}" ${columnDef.dataType.toUpperCase()}`;

        // Add length/precision for applicable types
        if (columnDef.length && ['VARCHAR', 'CHAR', 'CHARACTER'].includes(columnDef.dataType.toUpperCase())) {
            columnSpec += `(${columnDef.length})`;
        } else if (columnDef.precision && ['NUMERIC', 'DECIMAL'].includes(columnDef.dataType.toUpperCase())) {
            if (columnDef.scale !== undefined) {
                columnSpec += `(${columnDef.precision}, ${columnDef.scale})`;
            } else {
                columnSpec += `(${columnDef.precision})`;
            }
        }

        // Add NOT NULL constraint
        if (!columnDef.nullable) {
            columnSpec += ' NOT NULL';
        }

        // Add DEFAULT constraint
        if (columnDef.defaultValue) {
            columnSpec += ` DEFAULT ${columnDef.defaultValue}`;
        }

        // Add UNIQUE constraint
        if (columnDef.isUnique) {
            columnSpec += ' UNIQUE';
        }

        statements.push(`ALTER TABLE "${schema}"."${tableName}" ADD COLUMN ${columnSpec};`);

        // Add PRIMARY KEY constraint separately if needed
        if (columnDef.isPrimaryKey) {
            statements.push(`ALTER TABLE "${schema}"."${tableName}" ADD PRIMARY KEY ("${columnDef.name}");`);
        }

        return statements.join('\n');
    }

    /**
     * Generate EDIT COLUMN SQL
     */
    private static generateEditColumnSql(
        schema: string,
        tableName: string,
        oldColumnName: string,
        columnDef: ColumnDefinition,
        currentColumn: any
    ): string {
        const statements: string[] = [];

        // Check for column rename
        if (columnDef.name !== oldColumnName) {
            statements.push(`ALTER TABLE "${schema}"."${tableName}" RENAME COLUMN "${oldColumnName}" TO "${columnDef.name}";`);
        }

        const targetColumnName = columnDef.name;

        // Check for data type change
        const currentDataType = currentColumn.data_type.toUpperCase();
        const newDataType = columnDef.dataType.toUpperCase();
        
        let typeSpec = newDataType;
        if (columnDef.length && ['VARCHAR', 'CHAR', 'CHARACTER'].includes(newDataType)) {
            typeSpec += `(${columnDef.length})`;
        } else if (columnDef.precision && ['NUMERIC', 'DECIMAL'].includes(newDataType)) {
            if (columnDef.scale !== undefined) {
                typeSpec += `(${columnDef.precision}, ${columnDef.scale})`;
            } else {
                typeSpec += `(${columnDef.precision})`;
            }
        }

        const currentTypeSpec = this.getCurrentTypeSpec(currentColumn);
        if (typeSpec !== currentTypeSpec) {
            statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" TYPE ${typeSpec} USING "${targetColumnName}"::${typeSpec};`);
        }

        // Check for nullable change
        const currentNullable = currentColumn.is_nullable === 'YES';
        if (columnDef.nullable !== currentNullable) {
            if (columnDef.nullable) {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" DROP NOT NULL;`);
            } else {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" SET NOT NULL;`);
            }
        }

        // Check for default value change
        const currentDefault = currentColumn.column_default;
        if (columnDef.defaultValue !== currentDefault) {
            if (columnDef.defaultValue) {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" SET DEFAULT ${columnDef.defaultValue};`);
            } else if (currentDefault) {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" DROP DEFAULT;`);
            }
        }

        // Note: PRIMARY KEY and UNIQUE constraints are managed separately
        // They require constraint management which is more complex

        return statements.length > 0 ? statements.join('\n') : '-- No changes to apply';
    }

    /**
     * Helper to get current type specification
     */
    private static getCurrentTypeSpec(currentColumn: any): string {
        let typeSpec = currentColumn.data_type.toUpperCase();
        if (currentColumn.character_maximum_length) {
            typeSpec += `(${currentColumn.character_maximum_length})`;
        } else if (currentColumn.numeric_precision) {
            if (currentColumn.numeric_scale !== null && currentColumn.numeric_scale !== undefined) {
                typeSpec += `(${currentColumn.numeric_precision}, ${currentColumn.numeric_scale})`;
            } else {
                typeSpec += `(${currentColumn.numeric_precision})`;
            }
        }
        return typeSpec;
    }

    /**
     * Get webview content for React components
     */
    private static getWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        mode: 'createColumn' | 'editColumn',
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', `${mode}.js`)
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${mode === 'createColumn' ? 'Add Column' : 'Edit Column'}</title>
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
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}

