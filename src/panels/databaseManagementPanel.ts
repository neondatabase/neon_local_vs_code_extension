import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { NeonApiService } from '../services/api.service';

export interface DatabaseDefinition {
    name: string;
    owner?: string;
    encoding?: string;
}

export class DatabaseManagementPanel {
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
     * Create a new database
     */
    public static async createDatabase(
        context: vscode.ExtensionContext,
        stateService: StateService
    ): Promise<void> {
        const key = 'create_database';
        
        if (DatabaseManagementPanel.currentPanels.has(key)) {
            DatabaseManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createDatabase',
            'Create Database',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        DatabaseManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            DatabaseManagementPanel.currentPanels.delete(key);
        });

        try {
            // Get existing roles for owner selection and current user
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery(`
                SELECT current_user
            `, [], 'postgres');
            const currentUser = currentUserResult.rows[0]?.current_user || '';
            
            // Get roles, excluding Neon system roles
            // For database creation, allow any role as owner since that's what the extension will connect as
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname
                FROM pg_catalog.pg_roles
                WHERE rolname !~ '^pg_'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser', 'neon_service')
                ORDER BY rolname
            `, [], 'postgres');

            panel.webview.html = DatabaseManagementPanel.getCreateDatabaseHtml(
                panel.webview,
                context.extensionUri,
                rolesResult.rows.map(r => r.rolname),
                currentUser
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createDatabase':
                        await DatabaseManagementPanel.executeCreateDatabase(
                            context,
                            stateService,
                            message.dbDef,
                            panel
                        );
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open create database panel: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Drop a database
     */
    public static async dropDatabase(
        context: vscode.ExtensionContext,
        stateService: StateService,
        databaseName: string
    ): Promise<void> {
        try {
            // Confirm deletion
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop database "${databaseName}"?`,
                { modal: true, detail: 'This action cannot be undone. All data in this database will be permanently deleted.' },
                'Drop Database'
            );

            if (confirmation !== 'Drop Database') {
                return;
            }

            // Additional confirmation for safety
            const finalConfirm = await vscode.window.showWarningMessage(
                `FINAL WARNING: Dropping database "${databaseName}"`,
                { modal: true, detail: 'This will permanently delete all schemas, tables, and data.' },
                'Yes, Drop It'
            );

            if (finalConfirm !== 'Yes, Drop It') {
                return;
            }

            const sql = `DROP DATABASE ${databaseName};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, 'postgres');

            vscode.window.showInformationMessage(`Database "${databaseName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to drop database: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Execute create database using Neon API
     * This avoids PostgreSQL SET ROLE permission issues by using the Neon API
     * which handles ownership assignment internally
     */
    private static async executeCreateDatabase(
        context: vscode.ExtensionContext,
        stateService: StateService,
        dbDef: DatabaseDefinition,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            // Get currently connected project and branch
            const viewData = await stateService.getViewData();
            const projectId = viewData.connection.selectedProjectId;
            const branchId = viewData.connection.currentlyConnectedBranch;
            
            if (!projectId || !branchId) {
                throw new Error('No project or branch connected. Please connect first.');
            }

            console.debug(`Creating database via Neon API: project=${projectId}, branch=${branchId}, name=${dbDef.name}, owner=${dbDef.owner}`);

            // Use Neon API to create the database
            const apiService = new NeonApiService(context);
            await apiService.createDatabase(
                projectId,
                branchId,
                dbDef.name,
                dbDef.owner
            );

            // Refresh branch connection info to include the new database
            console.debug('Refreshing branch connection info after database creation...');
            const freshConnectionInfos = await apiService.getBranchConnectionInfo(projectId, branchId);
            await stateService.setBranchConnectionInfos(freshConnectionInfos);
            console.debug(`Branch connection info refreshed: ${freshConnectionInfos.length} configurations`);

            vscode.window.showInformationMessage(`Database "${dbDef.name}" created successfully!`);
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
     * Get HTML for create database panel (React version)
     */
    private static getCreateDatabaseHtml(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
        existingRoles: string[],
        currentUser: string
    ): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(extensionUri, 'dist', 'databaseManagement.js')
        );

        const nonce = this.getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Create Database</title>
</head>
<body>
    <div id="root"></div>
    <script nonce="${nonce}">
        window.initialData = ${JSON.stringify({ existingRoles, currentUser })};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Generate a nonce for CSP
     */
    private static getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

}


