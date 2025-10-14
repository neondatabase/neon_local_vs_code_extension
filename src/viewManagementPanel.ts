import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { SchemaService } from './services/schema.service';

export interface ViewDefinition {
    viewName: string;
    schema: string;
    sqlDefinition: string;
    materialized: boolean;
    replaceIfExists: boolean;
}

export class ViewManagementPanel {
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
            const schemaService = new SchemaService(stateService, context);
            const tables = await schemaService.getTables(database || 'postgres', schema);
            
            panel.webview.html = ViewManagementPanel.getCreateViewHtml(
                schema,
                tables.map(t => t.name)
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
                    definition,
                    CASE WHEN c.relkind = 'm' THEN true ELSE false END as is_materialized
                FROM pg_views v
                LEFT JOIN pg_class c ON c.relname = v.viewname AND c.relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = v.schemaname
                )
                WHERE schemaname = $1 AND viewname = $2
                UNION ALL
                SELECT 
                    definition,
                    true as is_materialized
                FROM pg_matviews
                WHERE schemaname = $1 AND matviewname = $2
            `, [schema, viewName], database);

            if (result.rows.length === 0) {
                throw new Error('View not found');
            }

            const viewData = result.rows[0];
            const schemaService = new SchemaService(stateService, context);
            const tables = await schemaService.getTables(database || 'postgres', schema);
            
            panel.webview.html = ViewManagementPanel.getEditViewHtml(
                schema,
                viewName,
                viewData.definition,
                viewData.is_materialized,
                tables.map(t => t.name)
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
                        const sql = ViewManagementPanel.generateCreateViewSql(message.viewDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load view definition: ${error}`);
            panel.dispose();
        }
    }

    /**
     * View properties and dependencies
     */
    public static async viewProperties(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        viewName: string,
        database?: string
    ): Promise<void> {
        const key = `props_view_${database || 'default'}.${schema}.${viewName}`;
        
        if (ViewManagementPanel.currentPanels.has(key)) {
            ViewManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'viewProperties',
            `View Properties: ${schema}.${viewName}`,
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
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get view definition and metadata
            const viewResult = await sqlService.executeQuery(`
                SELECT 
                    v.definition,
                    CASE WHEN c.relkind = 'm' THEN true ELSE false END as is_materialized,
                    pg_size_pretty(pg_total_relation_size(c.oid)) as size,
                    obj_description(c.oid, 'pg_class') as description
                FROM pg_views v
                LEFT JOIN pg_class c ON c.relname = v.viewname AND c.relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = v.schemaname
                )
                WHERE v.schemaname = $1 AND v.viewname = $2
                UNION ALL
                SELECT 
                    mv.definition,
                    true as is_materialized,
                    pg_size_pretty(pg_total_relation_size(c.oid)) as size,
                    obj_description(c.oid, 'pg_class') as description
                FROM pg_matviews mv
                LEFT JOIN pg_class c ON c.relname = mv.matviewname AND c.relnamespace = (
                    SELECT oid FROM pg_namespace WHERE nspname = mv.schemaname
                )
                WHERE mv.schemaname = $1 AND mv.matviewname = $2
            `, [schema, viewName], database);

            // Get view columns
            const columnsResult = await sqlService.executeQuery(`
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, viewName], database);

            // Get view dependencies (tables this view depends on)
            const depsResult = await sqlService.executeQuery(`
                SELECT DISTINCT
                    ref_nsp.nspname as schema_name,
                    ref_cl.relname as table_name,
                    ref_cl.relkind as object_type
                FROM pg_depend d
                JOIN pg_rewrite r ON r.oid = d.objid
                JOIN pg_class c ON c.oid = r.ev_class
                JOIN pg_class ref_cl ON ref_cl.oid = d.refobjid
                JOIN pg_namespace ref_nsp ON ref_nsp.oid = ref_cl.relnamespace
                WHERE c.relname = $1
                    AND c.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = $2)
                    AND d.deptype = 'n'
                    AND ref_cl.relkind IN ('r', 'v', 'm')
                ORDER BY schema_name, table_name
            `, [viewName, schema], database);

            panel.webview.html = ViewManagementPanel.getViewPropertiesHtml(
                schema,
                viewName,
                viewResult.rows[0] || {},
                columnsResult.rows,
                depsResult.rows
            );

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load view properties: ${error}`);
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
            const errorMessage = error instanceof Error ? error.message : String(error);
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to refresh materialized view: ${errorMessage}`);
            throw error;
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
            const errorMessage = error instanceof Error ? error.message : String(error);
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
            const sql = ViewManagementPanel.generateCreateViewSql(viewDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            const viewType = viewDef.materialized ? 'Materialized view' : 'View';
            vscode.window.showInformationMessage(`${viewType} "${viewDef.viewName}" updated successfully!`);
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
     * Generate CREATE VIEW SQL
     */
    private static generateCreateViewSql(viewDef: ViewDefinition): string {
        const {
            viewName,
            schema,
            sqlDefinition,
            materialized,
            replaceIfExists
        } = viewDef;

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
        
        return sql;
    }

    /**
     * Get HTML for create view panel
     */
    private static getCreateViewHtml(
        schema: string,
        tables: string[]
    ): string {
        const tablesJson = JSON.stringify(tables);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create View</title>
    <style>
        ${ViewManagementPanel.getCommonStyles()}
    </style>
</head>
<body>
    <div class="container">
        <h1>Create View</h1>
        
        <div id="errorContainer"></div>

        <div class="section">
            <div class="section-title">Schema: ${schema}</div>
            
            <div class="form-group">
                <label>View Name <span style="color: var(--vscode-errorForeground);">*</span></label>
                <input type="text" id="viewName" placeholder="my_view" />
                <div class="info-text">Naming convention: lowercase with underscores</div>
            </div>

            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="materializedView" />
                    <label for="materializedView" style="margin: 0;">Materialized View</label>
                </div>
                <div class="info-text">Materialized views store query results and must be refreshed</div>
            </div>

            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="replaceIfExists" checked />
                    <label for="replaceIfExists" style="margin: 0;">Replace if Exists</label>
                </div>
                <div class="info-text">Use CREATE OR REPLACE (not available for materialized views)</div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">SQL Definition <span style="color: var(--vscode-errorForeground);">*</span></div>
            <div class="info-text" style="margin-bottom: 8px;">Enter the SELECT statement for your view (without CREATE VIEW)</div>
            
            <textarea id="sqlDefinition" placeholder="SELECT id, name, email&#10;FROM users&#10;WHERE active = true"></textarea>

            <div class="helper-section">
                <div class="helper-title">Available Tables:</div>
                <div class="table-list" id="tableList"></div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">SQL Preview</div>
            <button class="btn btn-secondary" id="previewBtn">Generate SQL Preview</button>
            <div class="sql-preview" id="sqlPreview">-- Click "Generate SQL Preview" to see the CREATE VIEW statement</div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create View</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        ${ViewManagementPanel.getCreateViewScript(schema, tablesJson)}
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
        tables: string[]
    ): string {
        const tablesJson = JSON.stringify(tables);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit View</title>
    <style>
        ${ViewManagementPanel.getCommonStyles()}
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit View: ${viewName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section">
            <div class="section-title">Schema: ${schema}</div>
            
            <div class="form-group">
                <label>View Name</label>
                <input type="text" id="viewName" value="${viewName}" readonly />
            </div>

            <div class="form-group">
                <div class="info-badge ${isMaterialized ? 'badge-warning' : 'badge-info'}">
                    ${isMaterialized ? '📊 Materialized View' : '👁️ Regular View'}
                </div>
                <input type="hidden" id="materializedView" value="${isMaterialized}" />
            </div>

            <div class="form-group">
                <div class="checkbox-group">
                    <input type="checkbox" id="replaceIfExists" checked ${isMaterialized ? 'disabled' : ''} />
                    <label for="replaceIfExists" style="margin: 0;">Replace if Exists</label>
                </div>
                ${isMaterialized ? '<div class="info-text">Materialized views must be dropped and recreated</div>' : ''}
            </div>
        </div>

        <div class="section">
            <div class="section-title">SQL Definition <span style="color: var(--vscode-errorForeground);">*</span></div>
            <div class="info-text" style="margin-bottom: 8px;">Modify the SELECT statement for your view</div>
            
            <textarea id="sqlDefinition">${definition}</textarea>

            <div class="helper-section">
                <div class="helper-title">Available Tables:</div>
                <div class="table-list" id="tableList"></div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">SQL Preview</div>
            <button class="btn btn-secondary" id="previewBtn">Generate SQL Preview</button>
            <div class="sql-preview" id="sqlPreview">-- Click "Generate SQL Preview" to see the CREATE VIEW statement</div>
        </div>

        <div class="actions">
            <button class="btn" id="updateBtn">Update View</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        ${ViewManagementPanel.getEditViewScript(schema, viewName, isMaterialized, tablesJson)}
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for view properties panel
     */
    private static getViewPropertiesHtml(
        schema: string,
        viewName: string,
        viewData: any,
        columns: any[],
        dependencies: any[]
    ): string {
        const viewDataJson = JSON.stringify(viewData);
        const columnsJson = JSON.stringify(columns);
        const depsJson = JSON.stringify(dependencies);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>View Properties</title>
    <style>
        ${ViewManagementPanel.getCommonStyles()}
        .property-grid {
            display: grid;
            grid-template-columns: 200px 1fr;
            gap: 12px;
            margin-bottom: 20px;
        }
        .property-label {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }
        .property-value {
            font-family: monospace;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>View Properties: ${viewName}</h1>
        
        <div class="section">
            <div class="section-title">General Information</div>
            <div class="property-grid">
                <div class="property-label">Schema:</div>
                <div class="property-value">${schema}</div>
                
                <div class="property-label">View Name:</div>
                <div class="property-value">${viewName}</div>
                
                <div class="property-label">Type:</div>
                <div class="property-value" id="viewType"></div>
                
                <div class="property-label">Size:</div>
                <div class="property-value" id="viewSize"></div>
                
                <div class="property-label">Description:</div>
                <div class="property-value" id="viewDesc"></div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">Columns (<span id="colCount">0</span>)</div>
            <div id="columnsTable"></div>
        </div>

        <div class="section">
            <div class="section-title">Dependencies (<span id="depCount">0</span>)</div>
            <div class="info-text" style="margin-bottom: 8px;">Tables and views that this view depends on</div>
            <div id="dependenciesTable"></div>
        </div>

        <div class="section">
            <div class="section-title">View Definition</div>
            <div class="sql-preview" id="viewDefinition"></div>
        </div>

        <div class="actions">
            <button class="btn btn-secondary" id="closeBtn">Close</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const viewData = ${viewDataJson};
        const columns = ${columnsJson};
        const dependencies = ${depsJson};

        // Populate properties
        document.getElementById('viewType').textContent = viewData.is_materialized ? 'Materialized View' : 'Regular View';
        document.getElementById('viewSize').textContent = viewData.size || 'N/A';
        document.getElementById('viewDesc').textContent = viewData.description || 'No description';
        document.getElementById('viewDefinition').textContent = viewData.definition || 'No definition available';

        // Populate columns
        document.getElementById('colCount').textContent = columns.length;
        if (columns.length > 0) {
            let html = '<table><thead><tr>';
            html += '<th>Column Name</th><th>Data Type</th><th>Nullable</th><th>Default</th>';
            html += '</tr></thead><tbody>';
            columns.forEach(col => {
                html += '<tr>';
                html += \`<td><code>\${col.column_name}</code></td>\`;
                html += \`<td>\${col.data_type}</td>\`;
                html += \`<td>\${col.is_nullable === 'YES' ? '✓' : '✗'}</td>\`;
                html += \`<td>\${col.column_default || '-'}</td>\`;
                html += '</tr>';
            });
            html += '</tbody></table>';
            document.getElementById('columnsTable').innerHTML = html;
        } else {
            document.getElementById('columnsTable').innerHTML = '<div class="no-data">No columns found</div>';
        }

        // Populate dependencies
        document.getElementById('depCount').textContent = dependencies.length;
        if (dependencies.length > 0) {
            let html = '<table><thead><tr>';
            html += '<th>Schema</th><th>Object Name</th><th>Type</th>';
            html += '</tr></thead><tbody>';
            dependencies.forEach(dep => {
                const type = dep.object_type === 'r' ? 'Table' : dep.object_type === 'v' ? 'View' : 'Materialized View';
                html += '<tr>';
                html += \`<td>\${dep.schema_name}</td>\`;
                html += \`<td><code>\${dep.table_name}</code></td>\`;
                html += \`<td>\${type}</td>\`;
                html += '</tr>';
            });
            html += '</tbody></table>';
            document.getElementById('dependenciesTable').innerHTML = html;
        } else {
            document.getElementById('dependenciesTable').innerHTML = '<div class="no-data">No dependencies found</div>';
        }

        document.getElementById('closeBtn').addEventListener('click', () => {
            window.close();
        });
    </script>
</body>
</html>`;
    }

    /**
     * Common styles for all view panels
     */
    private static getCommonStyles(): string {
        return `
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            margin: 0;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
        }
        h1 {
            font-size: 24px;
            margin-bottom: 20px;
        }
        .section {
            margin-bottom: 20px;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 16px;
        }
        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 12px;
        }
        .form-group {
            margin-bottom: 16px;
        }
        label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
        }
        input[type="text"],
        select {
            width: 100%;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 6px 8px;
            font-size: 13px;
        }
        input[readonly] {
            opacity: 0.6;
            cursor: not-allowed;
        }
        textarea {
            width: 100%;
            min-height: 200px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            font-family: monospace;
            font-size: 13px;
            resize: vertical;
        }
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        .checkbox-group input[type="checkbox"] {
            cursor: pointer;
        }
        .info-text {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-top: 4px;
        }
        .info-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
        }
        .badge-info {
            background-color: var(--vscode-charts-blue);
            color: white;
        }
        .badge-warning {
            background-color: var(--vscode-charts-orange);
            color: white;
        }
        .helper-section {
            margin-top: 12px;
            padding: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            border-radius: 3px;
        }
        .helper-title {
            font-weight: 600;
            margin-bottom: 8px;
            font-size: 12px;
        }
        .table-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .table-chip {
            display: inline-block;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-family: monospace;
        }
        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
            margin-right: 8px;
        }
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .sql-preview {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 12px;
            font-family: monospace;
            font-size: 12px;
            white-space: pre-wrap;
            margin-top: 12px;
            max-height: 400px;
            overflow-y: auto;
        }
        .error {
            color: var(--vscode-errorForeground);
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 12px;
            border-radius: 3px;
            margin-bottom: 16px;
        }
        .actions {
            display: flex;
            gap: 8px;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        th, td {
            text-align: left;
            padding: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: 600;
        }
        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            font-size: 12px;
        }
        .no-data {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        `;
    }

    /**
     * JavaScript for create view panel
     */
    private static getCreateViewScript(schema: string, tablesJson: string): string {
        return `
        const vscode = acquireVsCodeApi();
        const tables = ${tablesJson};

        const viewNameInput = document.getElementById('viewName');
        const materializedCheckbox = document.getElementById('materializedView');
        const replaceCheckbox = document.getElementById('replaceIfExists');
        const sqlTextarea = document.getElementById('sqlDefinition');
        const previewBtn = document.getElementById('previewBtn');
        const sqlPreview = document.getElementById('sqlPreview');
        const createBtn = document.getElementById('createBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');
        const tableList = document.getElementById('tableList');

        // Render available tables
        tables.forEach(table => {
            const chip = document.createElement('span');
            chip.className = 'table-chip';
            chip.textContent = table;
            chip.style.cursor = 'pointer';
            chip.title = 'Click to insert table name';
            chip.addEventListener('click', () => {
                const cursorPos = sqlTextarea.selectionStart;
                const textBefore = sqlTextarea.value.substring(0, cursorPos);
                const textAfter = sqlTextarea.value.substring(cursorPos);
                sqlTextarea.value = textBefore + table + textAfter;
                sqlTextarea.focus();
                sqlTextarea.setSelectionRange(cursorPos + table.length, cursorPos + table.length);
            });
            tableList.appendChild(chip);
        });

        // Disable OR REPLACE for materialized views
        materializedCheckbox.addEventListener('change', () => {
            if (materializedCheckbox.checked) {
                replaceCheckbox.checked = false;
                replaceCheckbox.disabled = true;
            } else {
                replaceCheckbox.disabled = false;
            }
        });

        function getViewDefinition() {
            return {
                viewName: viewNameInput.value.trim(),
                schema: '${schema}',
                sqlDefinition: sqlTextarea.value.trim(),
                materialized: materializedCheckbox.checked,
                replaceIfExists: replaceCheckbox.checked && !materializedCheckbox.checked
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

        previewBtn.addEventListener('click', () => {
            if (!validateView()) return;
            vscode.postMessage({
                command: 'previewSql',
                viewDef: getViewDefinition()
            });
        });

        createBtn.addEventListener('click', () => {
            if (!validateView()) return;
            vscode.postMessage({
                command: 'createView',
                viewDef: getViewDefinition()
            });
        });

        cancelBtn.addEventListener('click', () => {
            window.close();
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
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }
        `;
    }

    /**
     * JavaScript for edit view panel
     */
    private static getEditViewScript(schema: string, viewName: string, isMaterialized: boolean, tablesJson: string): string {
        return `
        const vscode = acquireVsCodeApi();
        const tables = ${tablesJson};
        const isMaterialized = ${isMaterialized};

        const viewNameInput = document.getElementById('viewName');
        const materializedInput = document.getElementById('materializedView');
        const replaceCheckbox = document.getElementById('replaceIfExists');
        const sqlTextarea = document.getElementById('sqlDefinition');
        const previewBtn = document.getElementById('previewBtn');
        const sqlPreview = document.getElementById('sqlPreview');
        const updateBtn = document.getElementById('updateBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');
        const tableList = document.getElementById('tableList');

        // Render available tables
        tables.forEach(table => {
            const chip = document.createElement('span');
            chip.className = 'table-chip';
            chip.textContent = table;
            chip.style.cursor = 'pointer';
            chip.title = 'Click to insert table name';
            chip.addEventListener('click', () => {
                const cursorPos = sqlTextarea.selectionStart;
                const textBefore = sqlTextarea.value.substring(0, cursorPos);
                const textAfter = sqlTextarea.value.substring(cursorPos);
                sqlTextarea.value = textBefore + table + textAfter;
                sqlTextarea.focus();
                sqlTextarea.setSelectionRange(cursorPos + table.length, cursorPos + table.length);
            });
            tableList.appendChild(chip);
        });

        function getViewDefinition() {
            return {
                viewName: '${viewName}',
                schema: '${schema}',
                sqlDefinition: sqlTextarea.value.trim(),
                materialized: isMaterialized,
                replaceIfExists: replaceCheckbox.checked && !isMaterialized
            };
        }

        function validateView() {
            clearError();
            
            if (!sqlTextarea.value.trim()) {
                showError('SQL definition is required');
                return false;
            }
            
            return true;
        }

        previewBtn.addEventListener('click', () => {
            if (!validateView()) return;
            vscode.postMessage({
                command: 'previewSql',
                viewDef: getViewDefinition()
            });
        });

        updateBtn.addEventListener('click', () => {
            if (!validateView()) return;
            vscode.postMessage({
                command: 'updateView',
                viewDef: getViewDefinition()
            });
        });

        cancelBtn.addEventListener('click', () => {
            window.close();
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
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }
        `;
    }
}


