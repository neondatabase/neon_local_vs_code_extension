import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';

export interface ConstraintDefinition {
    constraintName: string;
    tableName: string;
    schema: string;
    constraintType: 'check' | 'unique' | 'exclusion' | 'foreignkey';
    columns?: string[];
    checkExpression?: string;
    exclusionMethod?: string;
    exclusionElements?: Array<{element: string; operator: string}>;
    foreignKeyReferencedTable?: string;
    foreignKeyReferencedSchema?: string;
    foreignKeyReferencedColumns?: string[];
    foreignKeyOnUpdate?: string;
    foreignKeyOnDelete?: string;
    foreignKeyMatch?: string;
    deferrable?: boolean;
    deferred?: boolean;
}

export class ConstraintManagementPanel {
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

    public static currentPanels = new Map<string, vscode.WebviewPanel>();

    /**
     * Create a new constraint on a table
     */
    public static async createConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `create_constraint_${database || 'default'}.${schema}.${tableName}`;
        
        if (ConstraintManagementPanel.currentPanels.has(key)) {
            ConstraintManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createConstraint',
            `Create Constraint on ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        ConstraintManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ConstraintManagementPanel.currentPanels.delete(key);
        });

        try {
            const schemaService = new SchemaService(stateService, context);
            const sqlService = new SqlQueryService(stateService, context);
            
            const columns = await schemaService.getColumns(database || 'neondb', schema, tableName);
            
            // Get all schemas (excluding system schemas)
            const schemasResult = await sqlService.executeQuery(`
                SELECT schema_name 
                FROM information_schema.schemata 
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
                ORDER BY schema_name
            `, [], database);
            
            // Get all tables from all user schemas
            const tablesResult = await sqlService.executeQuery(`
                SELECT schemaname, tablename 
                FROM pg_tables 
                WHERE schemaname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                ORDER BY schemaname, tablename
            `, [], database);
            
            const initialData = {
                schema,
                tableName,
                columns: columns.map(col => col.name),
                schemas: schemasResult.rows.map((row: any) => row.schema_name),
                tables: tablesResult.rows,
                mode: 'create'
            };

            panel.webview.html = ConstraintManagementPanel.getWebviewContent(context, panel, 'createConstraint', initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createConstraint':
                        await ConstraintManagementPanel.executeCreateConstraint(
                            context,
                            stateService,
                            message.constraintDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = ConstraintManagementPanel.generateCreateConstraintSql(message.constraintDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'fetchReferencedTableColumns':
                        try {
                            const schemaService = new SchemaService(stateService, context);
                            const refColumns = await schemaService.getColumns(
                                database || 'neondb', 
                                message.schema, 
                                message.table
                            );
                            panel.webview.postMessage({ 
                                command: 'referencedTableColumns', 
                                columns: refColumns.map(col => col.name) 
                            });
                        } catch (error) {
                            panel.webview.postMessage({ 
                                command: 'referencedTableColumns', 
                                columns: [],
                                error: error instanceof Error ? error.message : 'Failed to fetch columns'
                            });
                        }
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load table columns: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop a constraint
     */
    public static async dropConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        constraintName: string,
        cascade: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const cascadeStr = cascade ? ' CASCADE' : '';
            const sql = `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT "${constraintName}"${cascadeStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to drop constraint: ${errorMessage}`);
        }
    }

    /**
     * Edit an existing constraint
     */
    public static async editConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        constraintName: string,
        database?: string
    ): Promise<void> {
        const key = `edit_constraint_${database || 'default'}.${schema}.${tableName}.${constraintName}`;
        
        if (ConstraintManagementPanel.currentPanels.has(key)) {
            ConstraintManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'editConstraint',
            `Edit Constraint: ${constraintName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        ConstraintManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ConstraintManagementPanel.currentPanels.delete(key);
        });

        try {
            // Fetch constraint details
            const sqlService = new SqlQueryService(stateService, context);
            const result = await sqlService.executeQuery(`
                SELECT 
                    con.conname as name,
                    con.contype as constraint_type,
                    pg_get_constraintdef(con.oid) as definition,
                    con.condeferrable as is_deferrable,
                    con.condeferred as is_deferred,
                    con.conkey as column_attrnums
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE rel.relname = $1
                    AND nsp.nspname = $2
                    AND con.conname = $3
            `, [tableName, schema, constraintName], database);

            if (result.rows.length === 0) {
                vscode.window.showErrorMessage(`Constraint "${constraintName}" not found`);
                panel.dispose();
                return;
            }

            const constraintInfo = result.rows[0];
            
            // Get table columns
            const schemaService = new SchemaService(stateService, context);
            const columns = await schemaService.getColumns(database || 'neondb', schema, tableName);
            
            const initialData = {
                schema,
                tableName,
                columns: columns.map(col => col.name),
                currentConstraint: constraintInfo,
                mode: 'edit'
            };

            panel.webview.html = ConstraintManagementPanel.getWebviewContent(context, panel, 'editConstraint', initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'editConstraint':
                        await ConstraintManagementPanel.executeEditConstraint(
                            context,
                            stateService,
                            message.constraintDef,
                            constraintName,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = ConstraintManagementPanel.generateEditConstraintSql(
                            message.constraintDef,
                            constraintName
                        );
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load constraint: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Validate constraint (enable/disable validation)
     */
    public static async validateConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        constraintName: string,
        validate: boolean,
        database?: string
    ): Promise<void> {
        try {
            const validateStr = validate ? 'VALIDATE' : 'NOT VALID';
            const sql = `ALTER TABLE "${schema}"."${tableName}" ${validate ? 'VALIDATE' : 'ALTER'} CONSTRAINT "${constraintName}" ${validateStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintName}" ${validate ? 'validated' : 'marked as not valid'} successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to validate constraint: ${errorMessage}`);
        }
    }

    /**
     * Execute create constraint
     */
    private static async executeCreateConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        constraintDef: ConstraintDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = ConstraintManagementPanel.generateCreateConstraintSql(constraintDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintDef.constraintName}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
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
     * Execute edit constraint
     */
    private static async executeEditConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        constraintDef: ConstraintDefinition,
        oldConstraintName: string,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = ConstraintManagementPanel.generateEditConstraintSql(constraintDef, oldConstraintName);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintDef.constraintName}" updated successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
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
     * Generate CREATE CONSTRAINT SQL
     */
    private static generateCreateConstraintSql(constraintDef: ConstraintDefinition): string {
        const {
            constraintName,
            tableName,
            schema,
            constraintType,
            columns,
            checkExpression,
            exclusionMethod,
            exclusionElements,
            foreignKeyReferencedTable,
            foreignKeyReferencedSchema,
            foreignKeyReferencedColumns,
            foreignKeyOnUpdate,
            foreignKeyOnDelete,
            foreignKeyMatch,
            deferrable,
            deferred
        } = constraintDef;

        let sql = `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${constraintName}"`;

        switch (constraintType) {
            case 'check':
                sql += ` CHECK (${checkExpression})`;
                break;
            
            case 'unique':
                sql += ` UNIQUE (${columns!.map(col => `"${col}"`).join(', ')})`;
                break;
            
            case 'exclusion':
                sql += ` EXCLUDE USING ${exclusionMethod} (`;
                sql += exclusionElements!.map(el => `${el.element} WITH ${el.operator}`).join(', ');
                sql += ')';
                break;
            
            case 'foreignkey':
                sql += ` FOREIGN KEY (${columns!.map(col => `"${col}"`).join(', ')})`;
                sql += ` REFERENCES "${foreignKeyReferencedSchema}"."${foreignKeyReferencedTable}" (${foreignKeyReferencedColumns!.map(col => `"${col}"`).join(', ')})`;
                if (foreignKeyMatch && foreignKeyMatch !== 'SIMPLE') {
                    sql += ` MATCH ${foreignKeyMatch}`;
                }
                if (foreignKeyOnUpdate && foreignKeyOnUpdate !== 'NO ACTION') {
                    sql += ` ON UPDATE ${foreignKeyOnUpdate}`;
                }
                if (foreignKeyOnDelete && foreignKeyOnDelete !== 'NO ACTION') {
                    sql += ` ON DELETE ${foreignKeyOnDelete}`;
                }
                break;
        }

        if (deferrable) {
            sql += ' DEFERRABLE';
            if (deferred) {
                sql += ' INITIALLY DEFERRED';
            } else {
                sql += ' INITIALLY IMMEDIATE';
            }
        } else {
            sql += ' NOT DEFERRABLE';
        }

        sql += ';';
        return sql;
    }

    /**
     * Generate EDIT CONSTRAINT SQL (DROP + CREATE)
     */
    private static generateEditConstraintSql(constraintDef: ConstraintDefinition, oldConstraintName: string): string {
        const { tableName, schema } = constraintDef;
        
        // Drop the old constraint
        let sql = `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT "${oldConstraintName}";\n`;
        
        // Add the new constraint
        sql += ConstraintManagementPanel.generateCreateConstraintSql(constraintDef);
        
        return sql;
    }


    /**
     * Get webview content for React components
     */
    private static getWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        mode: 'createConstraint' | 'editConstraint',
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', `${mode}.js`)
        );

        const title = mode === 'createConstraint' ? 'Create Constraint' : 'Edit Constraint';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
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

