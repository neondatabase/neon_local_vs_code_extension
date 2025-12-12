import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { SqlQueryService } from '../services/sqlQuery.service';

export class PolicyManagementPanel {
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

    private static currentPanels: Map<string, vscode.WebviewPanel> = new Map();

    /**
     * Create a new RLS policy
     */
    public static async createPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `create_policy_${database || 'default'}.${schema}.${tableName}`;
        
        if (PolicyManagementPanel.currentPanels.has(key)) {
            PolicyManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createPolicy',
            `Create Policy: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        PolicyManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            PolicyManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get available roles (exclude PostgreSQL and Neon system roles)
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname 
                FROM pg_roles 
                WHERE rolname NOT LIKE 'pg_%'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname
            `, [], database);

            // Get table columns for expression suggestions
            const columnsResult = await sqlService.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, tableName], database);

            const initialData = {
                schema,
                tableName,
                roles: rolesResult.rows,
                columns: columnsResult.rows
            };

            panel.webview.html = PolicyManagementPanel.getWebviewContent(context, panel, initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createPolicy':
                        await PolicyManagementPanel.executeCreatePolicy(
                            context,
                            stateService,
                            schema,
                            tableName,
                            message.policyDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = PolicyManagementPanel.generateCreatePolicySql(
                            schema,
                            tableName,
                            message.policyDef
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
            vscode.window.showErrorMessage(`Failed to load policy creation form: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Edit an existing policy
     */
    public static async editPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        policyName: string,
        database?: string
    ): Promise<void> {
        const key = `edit_policy_${database || 'default'}.${schema}.${tableName}.${policyName}`;
        
        if (PolicyManagementPanel.currentPanels.has(key)) {
            PolicyManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'editPolicy',
            `Edit Policy: ${policyName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        PolicyManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            PolicyManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get current policy information
            const policyResult = await sqlService.executeQuery(`
                SELECT 
                    pol.polname as policy_name,
                    pol.polpermissive as is_permissive,
                    pol.polcmd as command,
                    ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) as roles,
                    pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
                    pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expression
                FROM pg_policy pol
                JOIN pg_class c ON pol.polrelid = c.oid
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE pol.polname = $1
                    AND c.relname = $2
                    AND n.nspname = $3
            `, [policyName, tableName, schema], database);

            if (policyResult.rows.length === 0) {
                vscode.window.showWarningMessage(`Policy "${policyName}" not found.`);
                panel.dispose();
                return;
            }

            const policyInfo = policyResult.rows[0];

            // Get available roles (exclude PostgreSQL and Neon system roles)
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname 
                FROM pg_roles 
                WHERE rolname NOT LIKE 'pg_%'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname
            `, [], database);

            // Get table columns
            const columnsResult = await sqlService.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, tableName], database);

            const initialData = {
                schema,
                tableName,
                policyName,
                policyInfo,
                roles: rolesResult.rows,
                columns: columnsResult.rows
            };

            panel.webview.html = PolicyManagementPanel.getEditWebviewContent(context, panel, initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'editPolicy':
                        await PolicyManagementPanel.executeEditPolicy(
                            context,
                            stateService,
                            schema,
                            tableName,
                            policyName,
                            message.policyDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = PolicyManagementPanel.generateEditPolicySql(
                            schema,
                            tableName,
                            policyName,
                            message.policyDef
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
            vscode.window.showErrorMessage(`Failed to load policy: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop a policy
     */
    public static async dropPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        policyName: string,
        database?: string
    ): Promise<void> {
        try {
            const sql = `DROP POLICY IF EXISTS "${policyName}" ON "${schema}"."${tableName}";`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Policy "${policyName}" dropped successfully!`);
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
            vscode.window.showErrorMessage(`Failed to drop policy: ${errorMessage}`);
        }
    }

    /**
     * Execute create policy
     */
    private static async executeCreatePolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        policyDef: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = PolicyManagementPanel.generateCreatePolicySql(schema, tableName, policyDef);
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Policy "${policyDef.name}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            const errorMessage = PolicyManagementPanel.extractErrorMessage(error);
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Execute edit policy
     */
    private static async executeEditPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        oldPolicyName: string,
        policyDef: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = PolicyManagementPanel.generateEditPolicySql(schema, tableName, oldPolicyName, policyDef);
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Policy "${policyDef.name}" updated successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            const errorMessage = PolicyManagementPanel.extractErrorMessage(error);
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Generate CREATE POLICY SQL
     */
    private static generateCreatePolicySql(schema: string, tableName: string, policyDef: any): string {
        const {
            name,
            type,
            command,
            roles,
            usingExpression,
            withCheckExpression
        } = policyDef;

        // Ensure roles is always an array and clean up any PostgreSQL array notation
        let rolesArray = Array.isArray(roles) ? roles : (roles ? [roles] : []);
        
        // Clean up role names - remove curly braces if present (from PostgreSQL array notation)
        rolesArray = rolesArray.map((r: string) => {
            if (typeof r === 'string') {
                return r.replace(/^\{|\}$/g, '');
            }
            return r;
        });

        let sql = `CREATE POLICY "${name}" ON "${schema}"."${tableName}"\n`;
        sql += `  AS ${type}\n`;
        sql += `  FOR ${command}\n`;
        
        if (rolesArray && rolesArray.length > 0) {
            sql += `  TO ${rolesArray.map((r: string) => r === 'PUBLIC' ? r : `"${r}"`).join(', ')}\n`;
        }
        
        if (usingExpression && usingExpression.trim()) {
            sql += `  USING (${usingExpression})\n`;
        }
        
        if (withCheckExpression && withCheckExpression.trim()) {
            sql += `  WITH CHECK (${withCheckExpression})\n`;
        }
        
        sql += ';';
        return sql;
    }

    /**
     * Generate EDIT POLICY SQL (DROP + CREATE)
     */
    private static generateEditPolicySql(schema: string, tableName: string, oldPolicyName: string, policyDef: any): string {
        // Drop the old policy
        let sql = `DROP POLICY IF EXISTS "${oldPolicyName}" ON "${schema}"."${tableName}";\n\n`;
        
        // Create the new policy
        sql += PolicyManagementPanel.generateCreatePolicySql(schema, tableName, policyDef);
        
        return sql;
    }

    /**
     * Get webview content for React components (Create Policy)
     */
    private static getWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'createPolicy.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Policy</title>
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

    /**
     * Get webview content for React components (Edit Policy)
     */
    private static getEditWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'editPolicy.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Policy</title>
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

