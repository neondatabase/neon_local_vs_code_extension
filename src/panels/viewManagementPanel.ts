import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';
import { getStyles } from '../templates/styles';

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
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `;
            const rolesResult = await sqlService.executeQuery(rolesQuery, database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery('SELECT current_user', database);
            const currentUser = currentUserResult.rows[0]?.current_user || '';
            
            panel.webview.html = ViewManagementPanel.getCreateViewHtml(
                schema,
                tables.map(t => t.name),
                existingRoles,
                currentUser
            );

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
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `;
            const rolesResult = await sqlService.executeQuery(rolesQuery, database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery('SELECT current_user', database);
            const currentUser = currentUserResult.rows[0]?.current_user || '';
            
            panel.webview.html = ViewManagementPanel.getEditViewHtml(
                schema,
                viewName,
                viewData.definition,
                viewData.is_materialized,
                viewData.owner,
                tables.map(t => t.name),
                existingRoles,
                currentUser
            );

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
        cascade: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const viewType = isMaterialized ? 'MATERIALIZED VIEW' : 'VIEW';
            const cascadeStr = cascade ? ' CASCADE' : ' RESTRICT';
            const sql = `DROP ${viewType} ${schema}.${viewName}${cascadeStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`${viewType} "${viewName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to drop view: ${errorMessage}`);
            throw error;
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
     * Get HTML for create view panel
     */
    private static getCreateViewHtml(
        schema: string,
        tables: string[],
        existingRoles: string[],
        currentUser: string
    ): string {
        const tablesJson = JSON.stringify(tables);
        const rolesJson = JSON.stringify(existingRoles);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create View</title>
    ${getStyles()}
    <style>
        textarea {
            width: 100%;
            min-height: 200px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            resize: vertical;
        }
        .helper-section {
            margin-top: 12px;
            padding: 12px;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
        }
        .helper-title {
            font-weight: 600;
            margin-bottom: 8px;
        }
        .table-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .table-badge {
            padding: 4px 8px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
        }
        .table-badge:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create View</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema</label>
                <input type="text" id="schemaInput" value="${schema}" readonly />
                <div class="info-text">The schema where this view will be created</div>
            </div>
            
            <div class="form-group">
                <label>View Name <span class="required">*</span></label>
                <input type="text" id="viewName" placeholder="my_view" />
                <div class="info-text">Naming convention: lowercase with underscores</div>
            </div>

            <div class="form-group">
                <label>Owner</label>
                <select id="ownerInput">
                    <option value="">Loading...</option>
                </select>
                <div class="info-text">The role that will own this view</div>
            </div>

            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="materializedView" />
                    <label for="materializedView">Materialized View</label>
                </div>
                <div class="info-text">Materialized views store query results and must be refreshed</div>
            </div>

            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="replaceIfExists" checked />
                    <label for="replaceIfExists">Replace if Exists</label>
                </div>
                <div class="info-text">Use CREATE OR REPLACE (not available for materialized views)</div>
            </div>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 12px; font-weight: 500;">SQL Definition <span class="required">*</span></div>
            <div class="info-text" style="margin-bottom: 12px;">Enter the SELECT statement for your view (without CREATE VIEW)</div>
            
            <textarea id="sqlDefinition" placeholder="SELECT id, name, email&#10;FROM users&#10;WHERE active = true"></textarea>

            <div class="helper-section">
                <div class="helper-title">Available Tables:</div>
                <div class="table-list" id="tableList"></div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <pre class="sql-preview" id="sqlPreview">-- Generating SQL preview...</pre>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create View</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        ${ViewManagementPanel.getCreateViewScript(schema, tablesJson, rolesJson, currentUser)}
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for edit view panel
     */
    private static getEditViewHtml(
        schema: string,
        viewName: string,
        definition: string,
        isMaterialized: boolean,
        currentOwner: string,
        tables: string[],
        existingRoles: string[],
        currentUser: string
    ): string {
        const tablesJson = JSON.stringify(tables);
        const rolesJson = JSON.stringify(existingRoles);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit View</title>
    ${getStyles()}
    <style>
        textarea {
            width: 100%;
            min-height: 200px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            resize: vertical;
        }
        .helper-section {
            margin-top: 12px;
            padding: 12px;
            background-color: var(--vscode-editor-background);
            border-radius: 3px;
        }
        .helper-title {
            font-weight: 600;
            margin-bottom: 8px;
        }
        .table-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }
        .table-badge {
            padding: 4px 8px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 3px;
            font-size: 12px;
            cursor: pointer;
        }
        .table-badge:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit View</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema</label>
                <input type="text" id="schemaInput" value="${schema}" readonly />
                <div class="info-text">The schema containing this view</div>
            </div>
            
            <div class="form-group">
                <label>View Name <span class="required">*</span></label>
                <input type="text" id="viewName" value="${viewName}" />
                <div class="info-text">Change the view name to rename it</div>
            </div>

            <div class="form-group">
                <label>Owner</label>
                <select id="ownerInput">
                    <option value="">Loading...</option>
                </select>
                <div class="info-text">The role that owns this view</div>
            </div>

            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="materializedView" ${isMaterialized ? 'checked' : ''} disabled />
                    <label for="materializedView">Materialized View</label>
                </div>
                <div class="info-text">View type cannot be changed after creation</div>
            </div>

            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="replaceIfExists" checked ${isMaterialized ? 'disabled' : ''} />
                    <label for="replaceIfExists">Replace if Exists</label>
                </div>
                ${isMaterialized ? '<div class="info-text">Materialized views must be dropped and recreated</div>' : '<div class="info-text">Use CREATE OR REPLACE (not available for materialized views)</div>'}
            </div>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 12px; font-weight: 500;">SQL Definition <span class="required">*</span></div>
            <div class="info-text" style="margin-bottom: 12px;">Modify the SELECT statement for your view</div>
            
            <textarea id="sqlDefinition">${definition}</textarea>

            <div class="helper-section">
                <div class="helper-title">Available Tables:</div>
                <div class="table-list" id="tableList"></div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <pre class="sql-preview" id="sqlPreview">-- Generating SQL preview...</pre>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="updateBtn">Update View</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        ${ViewManagementPanel.getEditViewScript(schema, viewName, isMaterialized, currentOwner, tablesJson, rolesJson, currentUser)}
    </script>
</body>
</html>`;
    }

    /**
     * JavaScript for create view panel
     */
    private static getCreateViewScript(schema: string, tablesJson: string, rolesJson: string, currentUser: string): string {
        return `
        const vscode = acquireVsCodeApi();
        const tables = ${tablesJson};
        const existingRoles = ${rolesJson};

        const viewNameInput = document.getElementById('viewName');
        const ownerInput = document.getElementById('ownerInput');
        const materializedCheckbox = document.getElementById('materializedView');
        const replaceCheckbox = document.getElementById('replaceIfExists');
        const sqlTextarea = document.getElementById('sqlDefinition');
        const sqlPreview = document.getElementById('sqlPreview');
        const createBtn = document.getElementById('createBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');
        const tableList = document.getElementById('tableList');

        // Populate owner dropdown
        ownerInput.innerHTML = '';
        if (existingRoles && existingRoles.length > 0) {
            existingRoles.forEach(role => {
                const option = document.createElement('option');
                option.value = role;
                option.textContent = role;
                // Select the current user by default
                if (role === '${currentUser}') {
                    option.selected = true;
                }
                ownerInput.appendChild(option);
            });
        }

        // Render available tables
        tables.forEach(table => {
            const badge = document.createElement('span');
            badge.className = 'table-badge';
            badge.textContent = table;
            badge.title = 'Click to insert table name';
            badge.addEventListener('click', () => {
                const cursorPos = sqlTextarea.selectionStart;
                const textBefore = sqlTextarea.value.substring(0, cursorPos);
                const textAfter = sqlTextarea.value.substring(cursorPos);
                sqlTextarea.value = textBefore + table + textAfter;
                sqlTextarea.focus();
                sqlTextarea.setSelectionRange(cursorPos + table.length, cursorPos + table.length);
                updatePreview();
            });
            tableList.appendChild(badge);
        });

        // Toggle section functionality
        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            if (section.style.display === 'none' || section.style.display === '') {
                section.style.display = 'block';
                icon.classList.add('expanded');
            } else {
                section.style.display = 'none';
                icon.classList.remove('expanded');
            }
        }
        window.toggleSection = toggleSection;

        // Disable OR REPLACE for materialized views
        materializedCheckbox.addEventListener('change', () => {
            if (materializedCheckbox.checked) {
                replaceCheckbox.checked = false;
                replaceCheckbox.disabled = true;
            } else {
                replaceCheckbox.disabled = false;
            }
            updatePreview();
        });

        // Event listeners for auto-updating preview
        viewNameInput.addEventListener('input', updatePreview);
        ownerInput.addEventListener('change', updatePreview);
        replaceCheckbox.addEventListener('change', updatePreview);
        sqlTextarea.addEventListener('input', updatePreview);

        function getViewDefinition() {
            return {
                viewName: viewNameInput.value.trim(),
                schema: '${schema}',
                sqlDefinition: sqlTextarea.value.trim(),
                materialized: materializedCheckbox.checked,
                replaceIfExists: replaceCheckbox.checked && !materializedCheckbox.checked,
                owner: ownerInput.value
            };
        }

        function validateView() {
            clearError();
            
            if (!viewNameInput.value.trim()) {
                showError('View name is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(viewNameInput.value.trim())) {
                showError('View name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }
            
            if (!sqlTextarea.value.trim()) {
                showError('SQL definition is required');
                return false;
            }
            
            return true;
        }

        function updatePreview() {
            vscode.postMessage({
                command: 'previewSql',
                viewDef: getViewDefinition()
            });
        }

        createBtn.addEventListener('click', () => {
            if (!validateView()) return;
            vscode.postMessage({
                command: 'createView',
                viewDef: getViewDefinition()
            });
        });

        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    sqlPreview.textContent = message.sql;
                    break;
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function showError(message) {
            errorContainer.innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }

        // Initial preview
        updatePreview();
        `;
    }

    /**
     * JavaScript for edit view panel
     */
    private static getEditViewScript(
        schema: string, 
        viewName: string, 
        isMaterialized: boolean, 
        currentOwner: string,
        tablesJson: string,
        rolesJson: string,
        currentUser: string
    ): string {
        return `
        const vscode = acquireVsCodeApi();
        const tables = ${tablesJson};
        const existingRoles = ${rolesJson};
        const isMaterialized = ${isMaterialized};
        const originalViewName = '${viewName}';
        const originalOwner = '${currentOwner}';

        const viewNameInput = document.getElementById('viewName');
        const ownerInput = document.getElementById('ownerInput');
        const materializedCheckbox = document.getElementById('materializedView');
        const replaceCheckbox = document.getElementById('replaceIfExists');
        const sqlTextarea = document.getElementById('sqlDefinition');
        const sqlPreview = document.getElementById('sqlPreview');
        const updateBtn = document.getElementById('updateBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');
        const tableList = document.getElementById('tableList');

        // Populate owner dropdown
        ownerInput.innerHTML = '';
        if (existingRoles && existingRoles.length > 0) {
            existingRoles.forEach(role => {
                const option = document.createElement('option');
                option.value = role;
                option.textContent = role;
                // Select the current owner by default
                if (role === originalOwner) {
                    option.selected = true;
                }
                ownerInput.appendChild(option);
            });
        }

        // Render available tables
        tables.forEach(table => {
            const badge = document.createElement('span');
            badge.className = 'table-badge';
            badge.textContent = table;
            badge.title = 'Click to insert table name';
            badge.addEventListener('click', () => {
                const cursorPos = sqlTextarea.selectionStart;
                const textBefore = sqlTextarea.value.substring(0, cursorPos);
                const textAfter = sqlTextarea.value.substring(cursorPos);
                sqlTextarea.value = textBefore + table + textAfter;
                sqlTextarea.focus();
                sqlTextarea.setSelectionRange(cursorPos + table.length, cursorPos + table.length);
                updatePreview();
            });
            tableList.appendChild(badge);
        });

        // Toggle section functionality
        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            if (section.style.display === 'none' || section.style.display === '') {
                section.style.display = 'block';
                icon.classList.add('expanded');
            } else {
                section.style.display = 'none';
                icon.classList.remove('expanded');
            }
        }
        window.toggleSection = toggleSection;

        // Event listeners for auto-updating preview
        viewNameInput.addEventListener('input', updatePreview);
        ownerInput.addEventListener('change', updatePreview);
        replaceCheckbox.addEventListener('change', updatePreview);
        sqlTextarea.addEventListener('input', updatePreview);

        function getViewDefinition() {
            return {
                viewName: viewNameInput.value.trim(),
                originalViewName: originalViewName,
                schema: '${schema}',
                sqlDefinition: sqlTextarea.value.trim(),
                materialized: isMaterialized,
                replaceIfExists: replaceCheckbox.checked && !isMaterialized,
                owner: ownerInput.value
            };
        }

        function validateView() {
            clearError();
            
            if (!viewNameInput.value.trim()) {
                showError('View name is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(viewNameInput.value.trim())) {
                showError('View name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }
            
            if (!sqlTextarea.value.trim()) {
                showError('SQL definition is required');
                return false;
            }
            
            return true;
        }

        function updatePreview() {
            vscode.postMessage({
                command: 'previewSql',
                viewDef: getViewDefinition()
            });
        }

        updateBtn.addEventListener('click', () => {
            if (!validateView()) return;
            vscode.postMessage({
                command: 'updateView',
                viewDef: getViewDefinition()
            });
        });

        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({
                command: 'cancel'
            });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    sqlPreview.textContent = message.sql;
                    break;
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function showError(message) {
            errorContainer.innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }

        // Initial preview
        updatePreview();
        `;
    }
}


