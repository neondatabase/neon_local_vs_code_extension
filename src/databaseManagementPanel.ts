import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { getStyles } from './templates/styles';

export interface DatabaseDefinition {
    name: string;
    owner?: string;
    encoding?: string;
}

export class DatabaseManagementPanel {
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
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname
                FROM pg_catalog.pg_roles
                WHERE rolname !~ '^pg_'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                ORDER BY rolname
            `, [], 'postgres');

            panel.webview.html = DatabaseManagementPanel.getCreateDatabaseHtml(
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
                    case 'previewSql':
                        const sql = DatabaseManagementPanel.generateCreateDatabaseSql(message.dbDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to drop database: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Execute create database
     */
    private static async executeCreateDatabase(
        context: vscode.ExtensionContext,
        stateService: StateService,
        dbDef: DatabaseDefinition,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = DatabaseManagementPanel.generateCreateDatabaseSql(dbDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, 'postgres');

            vscode.window.showInformationMessage(`Database "${dbDef.name}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Generate CREATE DATABASE SQL
     */
    private static generateCreateDatabaseSql(dbDef: DatabaseDefinition): string {
        const {
            name,
            owner,
            encoding
        } = dbDef;

        let sql = `CREATE DATABASE ${name}`;
        
        const options: string[] = [];
        
        if (owner) {
            options.push(`OWNER = ${owner}`);
        }
        
        if (encoding && encoding !== 'UTF8') {
            options.push(`ENCODING = '${encoding}'`);
        }
        
        if (options.length > 0) {
            sql += '\n  WITH ' + options.join('\n       ');
        }
        
        sql += ';';
        
        return sql;
    }

    /**
     * Get HTML for create database panel
     */
    private static getCreateDatabaseHtml(existingRoles: string[], currentUser: string): string {
        const rolesJson = JSON.stringify(existingRoles);
        const currentUserJson = JSON.stringify(currentUser);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Database</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Create Database</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Database Name</label>
                <input type="text" id="dbName" placeholder="mydb" />
                <div class="info-text">Must contain only letters, numbers, and underscores</div>
            </div>

            <div class="form-group">
                <label>Owner</label>
                <select id="owner">
                    <!-- Roles will be populated here -->
                </select>
                <div class="info-text">The database owner role</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('dbOptions')">
                <span class="toggle-icon" id="dbOptionsIcon">▶</span>
                Advanced Options
            </div>
            <div class="collapsible-content" id="dbOptions">
                <div class="form-group">
                    <label>Encoding</label>
                    <select id="encoding" disabled>
                        <option value="UTF8" selected>UTF8</option>
                    </select>
                    <div class="info-text">Neon only supports UTF8 encoding (Unicode, 8-bit variable-width)</div>
                </div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreview')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreview">
                <div class="sql-preview" id="sqlPreviewContent">-- Generating SQL preview...</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create Database</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const existingRoles = ${rolesJson};
        const currentUser = ${currentUserJson};

        // Populate roles dropdown and select current user by default
        const ownerSelect = document.getElementById('owner');
        existingRoles.forEach(role => {
            const option = document.createElement('option');
            option.value = role;
            option.textContent = role;
            // Select the current user by default
            if (role === currentUser) {
                option.selected = true;
            }
            ownerSelect.appendChild(option);
        });

        function getDatabaseDefinition() {
            const dbNameInput = document.getElementById('dbName');
            const dbName = dbNameInput.value.trim() || dbNameInput.placeholder;
            
            return {
                name: dbName,
                owner: document.getElementById('owner').value,
                encoding: document.getElementById('encoding').value
            };
        }

        function validateDatabase() {
            clearError();
            
            const dbNameInput = document.getElementById('dbName');
            const dbName = dbNameInput.value.trim() || dbNameInput.placeholder;
            
            if (!dbName) {
                showError('Database name is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(dbName)) {
                showError('Database name must start with a letter or underscore and contain only letters, numbers, and underscores');
                return false;
            }
            
            return true;
        }

        function updatePreview() {
            vscode.postMessage({
                command: 'previewSql',
                dbDef: getDatabaseDefinition()
            });
        }

        // Add event listeners to all form fields to auto-update preview
        document.getElementById('dbName').addEventListener('input', updatePreview);
        document.getElementById('owner').addEventListener('change', updatePreview);
        // encoding is disabled (Neon only supports UTF8), no listener needed

        document.getElementById('createBtn').addEventListener('click', () => {
            if (!validateDatabase()) return;
            vscode.postMessage({
                command: 'createDatabase',
                dbDef: getDatabaseDefinition()
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });

        // Generate initial preview
        updatePreview();

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    document.getElementById('sqlPreviewContent').textContent = message.sql;
                    break;
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId + 'Icon');
            
            if (content.style.display === 'none' || content.style.display === '') {
                content.style.display = 'block';
                icon.style.transform = 'rotate(90deg)';
            } else {
                content.style.display = 'none';
                icon.style.transform = 'rotate(0deg)';
            }
        }

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = '<div class="error">' + message + '</div>';
        }

        function clearError() {
            document.getElementById('errorContainer').innerHTML = '';
        }
    </script>
</body>
</html>`;
    }

}


