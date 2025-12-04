import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { SqlQueryService } from '../services/sqlQuery.service';

export class ForeignKeyManagementPanel {
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
     * Create a new foreign key
     */
    public static async createForeignKey(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `create_fk_${database}.${schema}.${tableName}`;
        
        if (ForeignKeyManagementPanel.currentPanels.has(key)) {
            ForeignKeyManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createForeignKey',
            `Create Foreign Key: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ForeignKeyManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ForeignKeyManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get columns from the current table
            const columnsResult = await sqlService.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, tableName], database);

            // Get all tables with their columns for reference
            const tablesResult = await sqlService.executeQuery(`
                SELECT 
                    t.table_schema,
                    t.table_name,
                    array_agg(c.column_name ORDER BY c.ordinal_position) as columns
                FROM information_schema.tables t
                JOIN information_schema.columns c 
                    ON c.table_schema = t.table_schema 
                    AND c.table_name = t.table_name
                WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
                    AND t.table_type = 'BASE TABLE'
                GROUP BY t.table_schema, t.table_name
                ORDER BY t.table_schema, t.table_name
            `, [], database);

            panel.webview.html = ForeignKeyManagementPanel.getCreateForeignKeyHtml(
                schema,
                tableName,
                columnsResult.rows,
                tablesResult.rows
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createForeignKey':
                        await ForeignKeyManagementPanel.executeCreateForeignKey(
                            context,
                            stateService,
                            schema,
                            tableName,
                            message.fkDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = ForeignKeyManagementPanel.generateCreateForeignKeySql(
                            schema,
                            tableName,
                            message.fkDef
                        );
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load table info: ${error}`);
            panel.dispose();
        }
    }

    /**
     * View foreign key properties
     */
    public static async viewForeignKeyProperties(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        fkName: string,
        database?: string
    ): Promise<void> {
        const key = `view_fk_${database}.${schema}.${tableName}.${fkName}`;
        
        if (ForeignKeyManagementPanel.currentPanels.has(key)) {
            ForeignKeyManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'viewForeignKey',
            `Foreign Key: ${fkName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ForeignKeyManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ForeignKeyManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get detailed foreign key information
            const fkResult = await sqlService.executeQuery(`
                SELECT
                    tc.constraint_name,
                    tc.table_schema,
                    tc.table_name,
                    kcu.column_name,
                    ccu.table_schema AS foreign_table_schema,
                    ccu.table_name AS foreign_table_name,
                    ccu.column_name AS foreign_column_name,
                    rc.update_rule,
                    rc.delete_rule,
                    rc.match_option
                FROM information_schema.table_constraints AS tc
                JOIN information_schema.key_column_usage AS kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                    ON ccu.constraint_name = tc.constraint_name
                    AND ccu.table_schema = tc.table_schema
                JOIN information_schema.referential_constraints AS rc
                    ON rc.constraint_name = tc.constraint_name
                    AND rc.constraint_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                    AND tc.constraint_name = $1
                    AND tc.table_schema = $2
                    AND tc.table_name = $3
                ORDER BY kcu.ordinal_position
            `, [fkName, schema, tableName], database);

            if (fkResult.rows.length === 0) {
                vscode.window.showWarningMessage(`Foreign key "${fkName}" not found.`);
                panel.dispose();
                return;
            }

            panel.webview.html = ForeignKeyManagementPanel.getViewForeignKeyPropertiesHtml(fkResult.rows);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load foreign key properties: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Drop a foreign key
     */
    public static async dropForeignKey(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        fkName: string,
        database?: string
    ): Promise<void> {
        try {
            const sql = `ALTER TABLE ${schema}.${tableName} DROP CONSTRAINT ${fkName};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Foreign key "${fkName}" dropped successfully!`);
            
            // Refresh the schema view
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
            
            vscode.window.showErrorMessage(`Failed to drop foreign key: ${errorMessage}`);
        }
    }

    /**
     * Execute foreign key creation
     */
    private static async executeCreateForeignKey(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        fkDef: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = ForeignKeyManagementPanel.generateCreateForeignKeySql(schema, tableName, fkDef);
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Foreign key "${fkDef.name}" created successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
            panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            panel.webview.postMessage({
                command: 'error',
                message: errorMessage
            });
        }
    }

    /**
     * Generate CREATE FOREIGN KEY SQL
     */
    private static generateCreateForeignKeySql(schema: string, tableName: string, fkDef: any): string {
        const {
            name,
            columns,
            refSchema,
            refTable,
            refColumns,
            onUpdate,
            onDelete,
            matchOption
        } = fkDef;

        let sql = `ALTER TABLE ${schema}.${tableName}\n`;
        sql += `  ADD CONSTRAINT ${name}\n`;
        sql += `  FOREIGN KEY (${columns.join(', ')})\n`;
        sql += `  REFERENCES ${refSchema}.${refTable} (${refColumns.join(', ')})`;
        
        if (matchOption && matchOption !== 'SIMPLE') {
            sql += `\n  MATCH ${matchOption}`;
        }
        
        if (onUpdate && onUpdate !== 'NO ACTION') {
            sql += `\n  ON UPDATE ${onUpdate}`;
        }
        
        if (onDelete && onDelete !== 'NO ACTION') {
            sql += `\n  ON DELETE ${onDelete}`;
        }
        
        sql += ';';
        
        return sql;
    }

    /**
     * Get HTML for create foreign key panel
     */
    private static getCreateForeignKeyHtml(
        schema: string,
        tableName: string,
        columns: any[],
        tables: any[]
    ): string {
        const columnsJson = JSON.stringify(columns);
        const tablesJson = JSON.stringify(tables);
        
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            font-size: 24px;
            margin-bottom: 20px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 5px;
            font-weight: 600;
        }
        input, select {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-size: 14px;
            margin-right: 10px;
        }
        .btn-primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn:hover {
            opacity: 0.9;
        }
        .multi-select {
            min-height: 100px;
        }
        .error {
            color: var(--vscode-errorForeground);
            margin-top: 10px;
            padding: 10px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
        .sql-preview {
            margin-top: 20px;
            padding: 15px;
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            white-space: pre-wrap;
            display: none;
        }
        .info {
            padding: 10px;
            background-color: var(--vscode-textBlockQuote-background);
            border-left: 3px solid var(--vscode-textLink-foreground);
            margin-bottom: 20px;
        }
        .column-mapping {
            display: flex;
            gap: 10px;
            align-items: center;
            margin-bottom: 10px;
        }
        .column-mapping select {
            flex: 1;
        }
        .add-mapping-btn {
            padding: 6px 12px;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create Foreign Key</h1>
        <div class="info">
            Creating foreign key on table: <strong>${schema}.${tableName}</strong>
        </div>

        <form id="fkForm">
            <div class="form-group">
                <label for="fkName">Constraint Name *</label>
                <input type="text" id="fkName" required placeholder="fk_tablename_reftable">
            </div>

            <div class="form-group">
                <label>Column Mappings *</label>
                <div id="columnMappings"></div>
                <button type="button" class="btn btn-secondary add-mapping-btn" onclick="addColumnMapping()">+ Add Column</button>
            </div>

            <div class="form-group">
                <label for="refTable">References Table *</label>
                <select id="refTable" required onchange="updateRefColumns()">
                    <option value="">Select a table...</option>
                </select>
            </div>

            <div class="form-group">
                <label for="matchOption">Match Option</label>
                <select id="matchOption">
                    <option value="SIMPLE">SIMPLE (default)</option>
                    <option value="FULL">FULL</option>
                    <option value="PARTIAL">PARTIAL</option>
                </select>
            </div>

            <div class="form-group">
                <label for="onUpdate">On Update</label>
                <select id="onUpdate">
                    <option value="NO ACTION">NO ACTION (default)</option>
                    <option value="RESTRICT">RESTRICT</option>
                    <option value="CASCADE">CASCADE</option>
                    <option value="SET NULL">SET NULL</option>
                    <option value="SET DEFAULT">SET DEFAULT</option>
                </select>
            </div>

            <div class="form-group">
                <label for="onDelete">On Delete</label>
                <select id="onDelete">
                    <option value="NO ACTION">NO ACTION (default)</option>
                    <option value="RESTRICT">RESTRICT</option>
                    <option value="CASCADE">CASCADE</option>
                    <option value="SET NULL">SET NULL</option>
                    <option value="SET DEFAULT">SET DEFAULT</option>
                </select>
            </div>

            <div style="margin-top: 30px;">
                <button type="button" class="btn btn-secondary" onclick="previewSql()">Preview SQL</button>
                <button type="submit" class="btn btn-primary">Create Foreign Key</button>
            </div>

            <div id="sqlPreview" class="sql-preview"></div>
            <div id="error" class="error" style="display: none;"></div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const columns = ${columnsJson};
        const tables = ${tablesJson};
        let refColumnsCache = {};
        
        // Populate reference tables dropdown
        const refTableSelect = document.getElementById('refTable');
        tables.forEach(table => {
            const option = document.createElement('option');
            option.value = JSON.stringify({ schema: table.table_schema, table: table.table_name });
            option.textContent = \`\${table.table_schema}.\${table.table_name}\`;
            refTableSelect.appendChild(option);
            
            // Cache columns for this table
            refColumnsCache[\`\${table.table_schema}.\${table.table_name}\`] = table.columns;
        });

        let mappingCounter = 0;

        function addColumnMapping() {
            const container = document.getElementById('columnMappings');
            const mapping = document.createElement('div');
            mapping.className = 'column-mapping';
            mapping.id = \`mapping-\${mappingCounter}\`;
            
            mapping.innerHTML = \`
                <select class="local-column" required>
                    <option value="">Local column...</option>
                    \${columns.map(c => \`<option value="\${c.column_name}">\${c.column_name}</option>\`).join('')}
                </select>
                <span>→</span>
                <select class="ref-column" required disabled>
                    <option value="">Select reference table first...</option>
                </select>
                <button type="button" class="btn btn-secondary" onclick="removeColumnMapping('\${mappingCounter}')">✕</button>
            \`;
            
            container.appendChild(mapping);
            mappingCounter++;
        }

        function removeColumnMapping(id) {
            const mapping = document.getElementById(\`mapping-\${id}\`);
            if (mapping) {
                mapping.remove();
            }
        }

        function updateRefColumns() {
            const refTableSelect = document.getElementById('refTable');
            const selectedTable = refTableSelect.value;
            
            if (!selectedTable) return;
            
            const tableInfo = JSON.parse(selectedTable);
            const refColumns = refColumnsCache[\`\${tableInfo.schema}.\${tableInfo.table}\`] || [];
            
            // Update all reference column selects
            document.querySelectorAll('.ref-column').forEach(select => {
                select.disabled = false;
                select.innerHTML = '<option value="">Reference column...</option>' +
                    refColumns.map(col => \`<option value="\${col}">\${col}</option>\`).join('');
            });
        }

        function getFormData() {
            const refTableValue = document.getElementById('refTable').value;
            if (!refTableValue) {
                throw new Error('Please select a reference table');
            }
            
            const refTableInfo = JSON.parse(refTableValue);
            const mappings = Array.from(document.querySelectorAll('.column-mapping'));
            
            if (mappings.length === 0) {
                throw new Error('Please add at least one column mapping');
            }
            
            const localColumns = [];
            const refColumns = [];
            
            mappings.forEach(mapping => {
                const localCol = mapping.querySelector('.local-column').value;
                const refCol = mapping.querySelector('.ref-column').value;
                
                if (!localCol || !refCol) {
                    throw new Error('Please complete all column mappings');
                }
                
                localColumns.push(localCol);
                refColumns.push(refCol);
            });
            
            return {
                name: document.getElementById('fkName').value.trim(),
                columns: localColumns,
                refSchema: refTableInfo.schema,
                refTable: refTableInfo.table,
                refColumns: refColumns,
                matchOption: document.getElementById('matchOption').value,
                onUpdate: document.getElementById('onUpdate').value,
                onDelete: document.getElementById('onDelete').value
            };
        }

        function previewSql() {
            try {
                const fkDef = getFormData();
                vscode.postMessage({ command: 'previewSql', fkDef });
            } catch (error) {
                showError(error.message);
            }
        }

        document.getElementById('fkForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            try {
                const fkDef = getFormData();
                vscode.postMessage({ command: 'createForeignKey', fkDef });
            } catch (error) {
                showError(error.message);
            }
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'sqlPreview') {
                document.getElementById('sqlPreview').textContent = message.sql;
                document.getElementById('sqlPreview').style.display = 'block';
            } else if (message.command === 'error') {
                showError(message.message);
            }
        });

        function showError(message) {
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }

        // Add initial mapping
        addColumnMapping();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for viewing foreign key properties
     */
    private static getViewForeignKeyPropertiesHtml(fkRows: any[]): string {
        const fk = fkRows[0]; // First row has constraint-level info
        
        return `<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            padding: 20px;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
        }
        h1 {
            font-size: 24px;
            margin-bottom: 20px;
        }
        .property-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
        }
        .property-table th,
        .property-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .property-table th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: 600;
        }
        .property-table tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .label {
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .section {
            margin-top: 30px;
        }
        .section h2 {
            font-size: 18px;
            margin-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Foreign Key: ${fk.constraint_name}</h1>

        <div class="section">
            <h2>General Information</h2>
            <table class="property-table">
                <tr>
                    <td class="label">Constraint Name</td>
                    <td>${fk.constraint_name}</td>
                </tr>
                <tr>
                    <td class="label">Source Table</td>
                    <td>${fk.table_schema}.${fk.table_name}</td>
                </tr>
                <tr>
                    <td class="label">Reference Table</td>
                    <td>${fk.foreign_table_schema}.${fk.foreign_table_name}</td>
                </tr>
                <tr>
                    <td class="label">Match Option</td>
                    <td>${fk.match_option || 'SIMPLE'}</td>
                </tr>
                <tr>
                    <td class="label">On Update</td>
                    <td>${fk.update_rule}</td>
                </tr>
                <tr>
                    <td class="label">On Delete</td>
                    <td>${fk.delete_rule}</td>
                </tr>
            </table>
        </div>

        <div class="section">
            <h2>Column Mappings</h2>
            <table class="property-table">
                <thead>
                    <tr>
                        <th>Source Column</th>
                        <th></th>
                        <th>Referenced Column</th>
                    </tr>
                </thead>
                <tbody>
                    ${fkRows.map(row => `
                        <tr>
                            <td>${row.column_name}</td>
                            <td>→</td>
                            <td>${row.foreign_column_name}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>`;
    }
}


