import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';

export interface ViewDefinition {
    viewName: string;
    schema: string;
    sqlDefinition: string;
    materialized: boolean;
    replaceIfExists: boolean;
    owner?: string;
    originalViewName?: string; // For rename operations
}

export class ViewManagementPanel {
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
     * Create a new view
     */
    public static async createView(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        database?: string
    ): Promise<void> {
        const key = `create_view_${database || 'default'}.${schema}`;
        
        if (ViewManagementPanel.currentPanels.has(key)) {
            ViewManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createView',
            `Create View: ${schema}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ViewManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ViewManagementPanel.currentPanels.delete(key);
        });

        try {
            // Load tables from schema for reference
            const sqlService = new SqlQueryService(stateService, context);
            const schemaService = new SchemaService(stateService, context);
            const tables = await schemaService.getTables(database || 'neondb', schema);
            
            // Get roles from database (excluding system roles and neon-specific roles)
            const rolesQuery = `
                SELECT rolname 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%' 
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser', 'neon_service')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `;
            const rolesResult = await sqlService.executeQuery(rolesQuery, database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery('SELECT current_user', database);
            const currentUser = currentUserResult.rows[0]?.current_user || '';
            
            const initialData = {
                schema,
                tables: tables.map(t => t.name),
                existingRoles,
                currentUser,
                mode: 'create'
            };
            
            panel.webview.html = ViewManagementPanel.getWebviewContent(context, panel, 'createView', initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createView':
                        await ViewManagementPanel.executeCreateView(
                            context,
                            stateService,
                            message.viewDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = ViewManagementPanel.generateCreateViewSql(message.viewDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load schema tables: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Edit an existing view
     */
    public static async editView(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        viewName: string,
        database?: string
    ): Promise<void> {
        const key = `edit_view_${database || 'default'}.${schema}.${viewName}`;
        
        if (ViewManagementPanel.currentPanels.has(key)) {
            ViewManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'editView',
            `Edit View: ${schema}.${viewName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ViewManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ViewManagementPanel.currentPanels.delete(key);
        });

        try {
            // Get view definition
            const sqlService = new SqlQueryService(stateService, context);
            const result = await sqlService.executeQuery(`
                SELECT 
                    v.definition,
                    CASE WHEN c.relkind = 'm' THEN true ELSE false END as is_materialized,
                    pg_get_userbyid(c.relowner) as owner
                FROM pg_views v
                LEFT JOIN pg_class c ON c.relname = v.viewname AND c.relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = v.schemaname
                )
                WHERE schemaname = $1 AND viewname = $2
                UNION ALL
                SELECT 
                    m.definition,
                    true as is_materialized,
                    pg_get_userbyid(c.relowner) as owner
                FROM pg_matviews m
                LEFT JOIN pg_class c ON c.relname = m.matviewname AND c.relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = m.schemaname
                )
                WHERE schemaname = $1 AND matviewname = $2
            `, [schema, viewName], database);

            if (result.rows.length === 0) {
                throw new Error('View not found');
            }

            const viewData = result.rows[0];
            const schemaService = new SchemaService(stateService, context);
            const tables = await schemaService.getTables(database || 'neondb', schema);
            
            // Get roles from database (excluding system roles and neon-specific roles)
            const rolesQuery = `
                SELECT rolname 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%' 
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser', 'neon_service')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `;
            const rolesResult = await sqlService.executeQuery(rolesQuery, database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery('SELECT current_user', database);
            const currentUser = currentUserResult.rows[0]?.current_user || '';
            
            const initialData = {
                schema,
                viewName,
                definition: viewData.definition,
                isMaterialized: viewData.is_materialized,
                owner: viewData.owner,
                tables: tables.map(t => t.name),
                existingRoles,
                currentUser,
                mode: 'edit'
            };
            
            panel.webview.html = ViewManagementPanel.getWebviewContent(context, panel, 'editView', initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'updateView':
                        await ViewManagementPanel.executeUpdateView(
                            context,
                            stateService,
                            message.viewDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = ViewManagementPanel.generateUpdateViewSql(message.viewDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load view definition: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Drop a view
     */
    public static async dropView(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        viewName: string,
        isMaterialized: boolean,
        database?: string
    ): Promise<void> {
        try {
            const viewType = isMaterialized ? 'materialized view' : 'view';
            const viewTypeSQL = isMaterialized ? 'MATERIALIZED VIEW' : 'VIEW';

            // Ask about CASCADE or RESTRICT
            const dropMode = await vscode.window.showQuickPick(
                [
                    {
                        label: `Drop ${viewType} Only`,
                        description: 'RESTRICT - Fails if other objects depend on this view',
                        value: 'RESTRICT'
                    },
                    {
                        label: `Drop ${viewType} and All Dependencies`,
                        description: 'CASCADE - Removes all dependent objects',
                        value: 'CASCADE'
                    }
                ],
                {
                    placeHolder: 'How should the view be dropped?',
                    title: `Drop ${viewType}: ${schema}.${viewName}`
                }
            );

            if (!dropMode) {
                return; // User cancelled
            }

            // Confirm the operation with strong warning
            const warningMessage = dropMode.value === 'CASCADE'
                ? `WARNING: This will permanently delete ${viewType} "${schema}.${viewName}" and ALL objects that depend on it. This action CANNOT be undone!`
                : `Are you sure you want to drop ${viewType} "${schema}.${viewName}"? This operation will fail if other objects depend on it.`;

            const confirm = await vscode.window.showErrorMessage(
                warningMessage,
                { modal: true },
                dropMode.value === 'CASCADE' ? 'Yes, Drop Everything' : `Drop ${viewType}`
            );

            if (!confirm) {
                return;
            }

            // Execute DROP VIEW statement
            const sql = `DROP ${viewTypeSQL} ${schema}.${viewName} ${dropMode.value};`;
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`${viewType} "${schema}.${viewName}" dropped successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to drop view: ${errorMessage}`);
        }
    }

    /**
     * Refresh a materialized view
     */
    public static async refreshMaterializedView(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        viewName: string,
        concurrent: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const concurrentStr = concurrent ? 'CONCURRENTLY ' : '';
            const sql = `REFRESH MATERIALIZED VIEW ${concurrentStr}${schema}.${viewName};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Materialized view "${viewName}" refreshed successfully!`);
            
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
            
            vscode.window.showErrorMessage(`Failed to refresh materialized view: ${errorMessage}`);
            throw new Error(errorMessage);
        }
    }

    /**
     * Execute create view
     */
    private static async executeCreateView(
        context: vscode.ExtensionContext,
        stateService: StateService,
        viewDef: ViewDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = ViewManagementPanel.generateCreateViewSql(viewDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            const viewType = viewDef.materialized ? 'Materialized view' : 'View';
            vscode.window.showInformationMessage(`${viewType} "${viewDef.viewName}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Execute update view
     */
    private static async executeUpdateView(
        context: vscode.ExtensionContext,
        stateService: StateService,
        viewDef: ViewDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = ViewManagementPanel.generateUpdateViewSql(viewDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            const viewType = viewDef.materialized ? 'Materialized view' : 'View';
            vscode.window.showInformationMessage(`${viewType} "${viewDef.viewName}" updated successfully!`);
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
     * Generate CREATE VIEW SQL (for creating new views)
     */
    private static generateCreateViewSql(viewDef: ViewDefinition): string {
        const {
            viewName,
            schema,
            sqlDefinition,
            materialized,
            replaceIfExists,
            owner
        } = viewDef;

        const viewType = materialized ? 'MATERIALIZED VIEW' : 'VIEW';

        let sql = 'CREATE';
        
        if (replaceIfExists) {
            sql += ' OR REPLACE';
        }
        
        if (materialized) {
            sql += ' MATERIALIZED VIEW';
        } else {
            sql += ' VIEW';
        }
        
        sql += ` ${schema}.${viewName} AS\n`;
        sql += sqlDefinition.trim();
        
        if (!sql.endsWith(';')) {
            sql += ';';
        }
        
        // Add owner if specified
        if (owner) {
            sql += `\n\nALTER ${viewType} ${schema}.${viewName} OWNER TO "${owner}";`;
        }
        
        return sql;
    }

    /**
     * Generate UPDATE VIEW SQL (for editing existing views)
     */
    private static generateUpdateViewSql(viewDef: ViewDefinition): string {
        const {
            viewName,
            schema,
            sqlDefinition,
            materialized,
            owner,
            originalViewName
        } = viewDef;

        const viewType = materialized ? 'MATERIALIZED VIEW' : 'VIEW';
        const currentViewName = originalViewName || viewName;
        const statements: string[] = [];

        // Step 1: Update the view definition using CREATE OR REPLACE
        // Note: CREATE OR REPLACE cannot be used with MATERIALIZED VIEWS
        if (materialized) {
            // For materialized views, we need to drop and recreate
            statements.push(`DROP MATERIALIZED VIEW IF EXISTS ${schema}.${currentViewName};`);
            statements.push(`CREATE MATERIALIZED VIEW ${schema}.${currentViewName} AS\n${sqlDefinition.trim()};`);
        } else {
            statements.push(`CREATE OR REPLACE VIEW ${schema}.${currentViewName} AS\n${sqlDefinition.trim()};`);
        }
        
        // Step 2: Rename if view name changed
        if (originalViewName && originalViewName !== viewName) {
            statements.push(`ALTER ${viewType} ${schema}.${originalViewName} RENAME TO ${viewName};`);
        }
        
        // Step 3: Change owner if specified
        if (owner) {
            statements.push(`ALTER ${viewType} ${schema}.${viewName} OWNER TO "${owner}";`);
        }
        
        return statements.join('\n\n');
    }

    /**
     * Get webview content for React components
     */
    private static getWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        mode: 'createView' | 'editView',
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
    <title>${mode === 'createView' ? 'Create View' : 'Edit View'}</title>
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


