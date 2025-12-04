import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { getStyles } from '../templates/styles';

export interface SchemaDefinition {
    name: string;
    owner?: string;
}

export class SchemaManagementPanel {
    
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
     * Create a new database schema
     */
    public static async createSchema(
        context: vscode.ExtensionContext,
        stateService: StateService,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'createSchema',
            'Create Schema',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        try {
            // Fetch existing roles for the owner dropdown
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get roles from database (excluding system roles and neon-specific roles)
            // Only show roles the current user is a member of (or if user is superuser)
            const rolesQuery = `
                SELECT rolname 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%' 
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `;
            const rolesResult = await sqlService.executeQuery(rolesQuery, database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery('SELECT current_user', database);
            const currentUser = currentUserResult.rows[0]?.current_user || '';

            panel.webview.html = SchemaManagementPanel.getCreateSchemaHtml(existingRoles, currentUser);

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'createSchema':
                            await SchemaManagementPanel.executeCreateSchema(
                                context,
                                stateService,
                                message.schemaDef,
                                panel,
                                database
                            );
                            break;
                        case 'previewSql':
                            const sql = SchemaManagementPanel.generateCreateSchemaSql(message.schemaDef);
                            panel.webview.postMessage({ command: 'sqlPreview', sql });
                            break;
                        case 'cancel':
                            panel.dispose();
                            break;
                    }
                });

        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to open create schema panel: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Execute create schema
     */
    private static async executeCreateSchema(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schemaDef: SchemaDefinition,
        panel: vscode.WebviewPanel,
        database?: string
    ): Promise<void> {
        try {
            const sql = SchemaManagementPanel.generateCreateSchemaSql(schemaDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Schema "${schemaDef.name}" created successfully!`);
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
     * Quote a PostgreSQL identifier to preserve case and handle special characters
     */
    private static quoteIdentifier(identifier: string): string {
        // Escape any double quotes by doubling them
        const escaped = identifier.replace(/"/g, '""');
        // Wrap in double quotes
        return `"${escaped}"`;
    }

    /**
     * Generate CREATE SCHEMA SQL
     */
    private static generateCreateSchemaSql(schemaDef: SchemaDefinition): string {
        const { name, owner } = schemaDef;

        let sql = `CREATE SCHEMA ${this.quoteIdentifier(name)}`;
        
        if (owner) {
            sql += ` AUTHORIZATION ${this.quoteIdentifier(owner)}`;
        }
        
        sql += ';';
        
        return sql;
    }

    /**
     * Get HTML for create schema panel
     */
    private static getCreateSchemaHtml(existingRoles: string[], currentUser: string): string {
        const rolesJson = JSON.stringify(existingRoles);
        const currentUserJson = JSON.stringify(currentUser);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Schema</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Create Schema</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema Name</label>
                <input type="text" id="schemaName" placeholder="my_schema" />
                <div class="info-text">Must start with a letter and contain only letters, numbers, and underscores. Cannot use reserved prefixes (pg_, information_schema).</div>
            </div>

            <div class="form-group">
                <label>Owner</label>
                <select id="owner">
                    <!-- Roles will be populated here -->
                </select>
                <div class="info-text">The schema owner role</div>
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
            <button class="btn" id="createBtn">Create Schema</button>
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

        function getSchemaDefinition() {
            const schemaNameInput = document.getElementById('schemaName');
            const schemaName = schemaNameInput.value.trim() || schemaNameInput.placeholder;
            
            return {
                name: schemaName,
                owner: document.getElementById('owner').value
            };
        }

        function validateSchema() {
            clearError();
            
            const schemaNameInput = document.getElementById('schemaName');
            const schemaName = schemaNameInput.value.trim() || schemaNameInput.placeholder;

            if (!schemaName) {
                showError('Schema name is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
                showError('Schema name must start with a letter or underscore and contain only letters, numbers, and underscores');
                return false;
            }
            
            // Check for reserved prefixes
            const reserved = ['pg_', 'information_schema', 'pg_catalog', 'pg_toast'];
            if (reserved.some(r => schemaName.toLowerCase().startsWith(r.toLowerCase()))) {
                showError('Cannot use reserved schema name prefix');
                return false;
            }
            
            return true;
        }

        document.getElementById('createBtn').addEventListener('click', () => {
            if (!validateSchema()) {
                return;
            }
            
            vscode.postMessage({
                command: 'createSchema',
                schemaDef: getSchemaDefinition()
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });

        // Generate initial preview
        updatePreview();

        // Add event listeners for auto-updating preview
        document.getElementById('schemaName').addEventListener('input', updatePreview);
        document.getElementById('owner').addEventListener('change', updatePreview);

        function updatePreview() {
            vscode.postMessage({
                command: 'previewSql',
                schemaDef: getSchemaDefinition()
            });
        }

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
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            document.getElementById('errorContainer').innerHTML = '';
        }
    </script>
</body>
</html>`;
    }

    private static getEditSchemaHtml(
        currentSchemaName: string,
        currentOwner: string,
        existingRoles: string[]
    ): string {
        const rolesJson = JSON.stringify(existingRoles);
        const currentOwnerJson = JSON.stringify(currentOwner);
        const currentNameJson = JSON.stringify(currentSchemaName);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Schema</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Edit Schema: ${currentSchemaName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema Name</label>
                <input type="text" id="schemaName" value="${currentSchemaName}" />
                <div class="info-text">Must start with a letter and contain only letters, numbers, and underscores. Cannot use reserved prefixes (pg_, information_schema).</div>
            </div>

            <div class="form-group">
                <label>Owner</label>
                <select id="owner">
                    <!-- Roles will be populated here -->
                </select>
                <div class="info-text">The schema owner role</div>
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
            <button class="btn" id="editBtn">Update Schema</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const existingRoles = ${rolesJson};
        const currentOwner = ${currentOwnerJson};
        const originalSchemaName = ${currentNameJson};

        // Populate roles dropdown and select current owner
        const ownerSelect = document.getElementById('owner');
        existingRoles.forEach(role => {
            const option = document.createElement('option');
            option.value = role;
            option.textContent = role;
            // Select the current owner
            if (role === currentOwner) {
                option.selected = true;
            }
            ownerSelect.appendChild(option);
        });

        function getSchemaDefinition() {
            return {
                name: document.getElementById('schemaName').value.trim(),
                owner: document.getElementById('owner').value
            };
        }

        function validateSchema() {
            clearError();
            
            const schemaName = document.getElementById('schemaName').value.trim();
            
            if (!schemaName) {
                showError('Schema name is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
                showError('Schema name must start with a letter or underscore and contain only letters, numbers, and underscores');
                return false;
            }
            
            // Check for reserved prefixes
            const reserved = ['pg_', 'information_schema', 'pg_catalog', 'pg_toast'];
            if (reserved.some(r => schemaName.toLowerCase().startsWith(r.toLowerCase()))) {
                showError('Cannot use reserved schema name prefix');
                return false;
            }
            
            return true;
        }

        document.getElementById('editBtn').addEventListener('click', () => {
            if (!validateSchema()) {
                return;
            }
            
            vscode.postMessage({
                command: 'editSchema',
                schemaDef: getSchemaDefinition()
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });

        // Generate initial preview
        updatePreview();

        // Add event listeners for auto-updating preview
        document.getElementById('schemaName').addEventListener('input', updatePreview);
        document.getElementById('owner').addEventListener('change', updatePreview);

        function updatePreview() {
            vscode.postMessage({
                command: 'previewSql',
                schemaDef: getSchemaDefinition()
            });
        }

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
            const isExpanded = content.style.display === 'block';
            content.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            document.getElementById('errorContainer').innerHTML = '';
        }
    </script>
</body>
</html>`;
    }

    private static generateEditSchemaSql(originalSchemaName: string, schemaDef: any): string {
        const statements: string[] = [];
        
        // Check if name changed
        if (schemaDef.name && schemaDef.name !== originalSchemaName) {
            statements.push(`ALTER SCHEMA "${originalSchemaName}" RENAME TO "${schemaDef.name}";`);
        }
        
        // Always include owner change (using the new name if renamed, else original)
        const schemaName = schemaDef.name || originalSchemaName;
        statements.push(`ALTER SCHEMA "${schemaName}" OWNER TO "${schemaDef.owner}";`);
        
        return statements.join('\n');
    }

    private static async executeEditSchema(
        context: vscode.ExtensionContext,
        stateService: StateService,
        originalSchemaName: string,
        schemaDef: any,
        panel: vscode.WebviewPanel,
        database?: string
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Check if it's a system schema
            const systemSchemas = ['public', 'information_schema', 'pg_catalog', 'pg_toast'];
            if (systemSchemas.includes(originalSchemaName.toLowerCase())) {
                panel.webview.postMessage({
                    command: 'error',
                    error: `Cannot modify system schema "${originalSchemaName}"`
                });
                return;
            }

            // Validate schema name
            if (!/^[a-z_][a-z0-9_]*$/i.test(schemaDef.name)) {
                panel.webview.postMessage({
                    command: 'error',
                    error: 'Invalid schema name. Must start with a letter or underscore and contain only letters, numbers, and underscores.'
                });
                return;
            }

            // Check for reserved prefixes
            const reserved = ['pg_', 'information_schema', 'pg_catalog', 'pg_toast'];
            if (reserved.some(r => schemaDef.name.toLowerCase().startsWith(r.toLowerCase()))) {
                panel.webview.postMessage({
                    command: 'error',
                    error: 'Cannot use reserved schema name prefix'
                });
                return;
            }

            // Rename schema if name changed
            if (schemaDef.name && schemaDef.name !== originalSchemaName) {
                await sqlService.executeQuery(
                    `ALTER SCHEMA "${originalSchemaName}" RENAME TO "${schemaDef.name}"`,
                    [],
                    database
                );
            }

            // Change owner (using new name if renamed)
            const currentSchemaName = schemaDef.name || originalSchemaName;
            await sqlService.executeQuery(
                `ALTER SCHEMA "${currentSchemaName}" OWNER TO "${schemaDef.owner}"`,
                [],
                database
            );

            vscode.window.showInformationMessage(`Schema updated successfully`);
            panel.dispose();
            
            // Refresh the schema view
            vscode.commands.executeCommand('neonLocal.schema.refresh');
        } catch (error) {
            let errorMessage = 'Unknown error';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                errorMessage = JSON.stringify(error);
            } else if (typeof error === 'string') {
                errorMessage = error;
            }

            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Edit schema
     */
    public static async editSchema(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schemaName: string,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'editSchema',
            `Edit Schema: ${schemaName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get current schema properties
            const schemaResult = await sqlService.executeQuery(`
                SELECT 
                    s.nspname as schema_name,
                    pg_catalog.pg_get_userbyid(s.nspowner) as owner
                FROM pg_catalog.pg_namespace s
                WHERE s.nspname = $1
            `, [schemaName], database);

            if (schemaResult.rows.length === 0) {
                vscode.window.showErrorMessage(`Schema "${schemaName}" not found`);
                panel.dispose();
                return;
            }

            const currentSchema = schemaResult.rows[0];

            // Get available roles (excluding system roles and neon-specific roles)
            // Only show roles the current user is a member of (or if user is superuser)
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%' 
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname
            `, [], database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            panel.webview.html = SchemaManagementPanel.getEditSchemaHtml(
                schemaName,
                currentSchema.owner,
                existingRoles
            );

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'editSchema':
                            await SchemaManagementPanel.executeEditSchema(
                                context,
                                stateService,
                                schemaName,
                                message.schemaDef,
                                panel,
                                database
                            );
                            break;
                        case 'previewSql':
                            const sql = SchemaManagementPanel.generateEditSchemaSql(schemaName, message.schemaDef);
                            panel.webview.postMessage({ command: 'sqlPreview', sql });
                            break;
                        case 'cancel':
                            panel.dispose();
                            break;
                    }
                });
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to open edit schema panel: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Rename a database schema
     */
    public static async renameSchema(
        context: vscode.ExtensionContext,
        stateService: StateService,
        currentSchemaName: string,
        database?: string
    ): Promise<void> {
        try {
            // Check if it's a system schema
            const systemSchemas = ['public', 'information_schema', 'pg_catalog', 'pg_toast'];
            if (systemSchemas.includes(currentSchemaName.toLowerCase())) {
                vscode.window.showErrorMessage(`Cannot rename system schema "${currentSchemaName}"`);
                return;
            }

            // Prompt for new schema name
            const newSchemaName = await vscode.window.showInputBox({
                prompt: `Enter the new name for schema "${currentSchemaName}"`,
                placeHolder: 'e.g., new_schema_name',
                value: currentSchemaName,
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Schema name cannot be empty';
                    }
                    if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
                        return 'Schema name must start with a letter and contain only letters, numbers, and underscores';
                    }
                    if (value === currentSchemaName) {
                        return 'New name must be different from current name';
                    }
                    // Reserved schema names
                    const reserved = ['pg_', 'information_schema', 'pg_catalog', 'pg_toast'];
                    if (reserved.some(r => value.toLowerCase().startsWith(r.toLowerCase()))) {
                        return 'Cannot use reserved schema name prefix';
                    }
                    return null;
                }
            });

            if (!newSchemaName) {
                return; // User cancelled
            }

            // Confirm the operation
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to rename schema "${currentSchemaName}" to "${newSchemaName}"? This will affect all objects in the schema.`,
                { modal: true },
                'Rename Schema'
            );

            if (confirm !== 'Rename Schema') {
                return;
            }

            // Execute RENAME statement
            const sql = `ALTER SCHEMA "${currentSchemaName}" RENAME TO "${newSchemaName}";`;
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Schema renamed from "${currentSchemaName}" to "${newSchemaName}" successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to rename schema: ${errorMessage}`);
        }
    }

    /**
     * Change schema owner
     */
    public static async changeSchemaOwner(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schemaName: string,
        database?: string
    ): Promise<void> {
        try {
            // Check if it's a system schema
            const systemSchemas = ['information_schema', 'pg_catalog', 'pg_toast'];
            if (systemSchemas.includes(schemaName.toLowerCase())) {
                vscode.window.showErrorMessage(`Cannot change owner of system schema "${schemaName}"`);
                return;
            }

            // Fetch available roles
            // Only show roles the current user is a member of (or if user is superuser)
            const sqlService = new SqlQueryService(stateService, context);
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname as name 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `, database);

            if (!rolesResult.rows || rolesResult.rows.length === 0) {
                vscode.window.showErrorMessage('No roles available for assignment');
                return;
            }

            // Get current owner
            const currentOwnerResult = await sqlService.executeQuery(`
                SELECT n.nspowner::regrole::text as owner
                FROM pg_catalog.pg_namespace n
                WHERE n.nspname = $1;
            `, [schemaName], database);

            const currentOwner = currentOwnerResult.rows[0]?.owner || '';

            // Create QuickPick items
            const roleItems = rolesResult.rows.map(row => ({
                label: row.name,
                description: row.name === currentOwner ? '(current owner)' : undefined,
                picked: row.name === currentOwner
            }));

            // Show QuickPick to select new owner
            const selectedRole = await vscode.window.showQuickPick(roleItems, {
                placeHolder: `Select the new owner for schema "${schemaName}"`,
                title: 'Change Schema Owner'
            });

            if (!selectedRole) {
                return; // User cancelled
            }

            const newOwner = selectedRole.label;

            // Check if the selected owner is the same as current
            if (newOwner === currentOwner) {
                vscode.window.showInformationMessage(`Schema "${schemaName}" is already owned by "${newOwner}"`);
                return;
            }

            // Execute ALTER SCHEMA statement
            const sql = `ALTER SCHEMA "${schemaName}" OWNER TO "${newOwner}";`;
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Schema "${schemaName}" owner changed to "${newOwner}" successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to change schema owner: ${errorMessage}`);
        }
    }

    /**
     * Drop/delete a database schema
     */
    public static async dropSchema(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schemaName: string,
        database?: string
    ): Promise<void> {
        try {
            // Check if it's a system schema
            const systemSchemas = ['public', 'information_schema', 'pg_catalog', 'pg_toast'];
            if (systemSchemas.includes(schemaName.toLowerCase())) {
                vscode.window.showErrorMessage(`Cannot drop system schema "${schemaName}"`);
                return;
            }

            // Ask about CASCADE or RESTRICT
            const dropMode = await vscode.window.showQuickPick(
                [
                    {
                        label: 'Drop Schema Only (if empty)',
                        description: 'RESTRICT - Fails if schema contains any objects',
                        value: 'RESTRICT'
                    },
                    {
                        label: 'Drop Schema and All Contents',
                        description: 'CASCADE - Removes all objects in the schema',
                        value: 'CASCADE'
                    }
                ],
                {
                    placeHolder: 'How should the schema be dropped?',
                    title: `Drop Schema: ${schemaName}`
                }
            );

            if (!dropMode) {
                return; // User cancelled
            }

            // Confirm the operation with strong warning
            const warningMessage = dropMode.value === 'CASCADE'
                ? `WARNING: This will permanently delete schema "${schemaName}" and ALL of its contents (tables, views, functions, etc.). This action CANNOT be undone!`
                : `Are you sure you want to drop schema "${schemaName}"? This operation will fail if the schema is not empty.`;

            const confirm = await vscode.window.showErrorMessage(
                warningMessage,
                { modal: true },
                dropMode.value === 'CASCADE' ? 'Yes, Drop Everything' : 'Drop Schema'
            );

            if (!confirm) {
                return;
            }

            // Execute DROP SCHEMA statement
            const sql = `DROP SCHEMA "${schemaName}" ${dropMode.value};`;
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Schema "${schemaName}" dropped successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to drop schema: ${errorMessage}`);
        }
    }

    /**
     * Show schema properties/information
     */
    public static async showSchemaProperties(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schemaName: string,
        database?: string
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get schema information
            const query = `
                SELECT 
                    schema_name,
                    schema_owner,
                    (SELECT COUNT(*) FROM information_schema.tables 
                     WHERE table_schema = schema_name) as table_count,
                    (SELECT COUNT(*) FROM information_schema.views 
                     WHERE table_schema = schema_name) as view_count,
                    (SELECT COUNT(*) FROM information_schema.routines 
                     WHERE routine_schema = schema_name) as function_count
                FROM information_schema.schemata
                WHERE schema_name = '${schemaName}';
            `;
            
            const result = await sqlService.executeQuery(query, database);
            
            if (result.rows.length === 0) {
                vscode.window.showErrorMessage(`Schema "${schemaName}" not found`);
                return;
            }

            const info = result.rows[0];
            
            const message = `
Schema: ${info.schema_name}
Owner: ${info.schema_owner || 'Unknown'}
Tables: ${info.table_count}
Views: ${info.view_count}
Functions: ${info.function_count}
            `.trim();

            vscode.window.showInformationMessage(message, { modal: false });
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to get schema properties: ${errorMessage}`);
        }
    }
}


