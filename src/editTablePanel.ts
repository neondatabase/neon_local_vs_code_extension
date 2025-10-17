import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { SchemaService } from './services/schema.service';
import { getStyles } from './templates/styles';

export interface ColumnChange {
    action: 'add' | 'modify' | 'drop';
    oldName?: string;
    newName: string;
    dataType: string;
    length?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    isUnique: boolean;
    comment?: string;
}

export interface TableSchemaEdit {
    schema: string;
    tableName: string;
    changes: ColumnChange[];
}

export class EditTablePanel {
    public static currentPanels = new Map<string, EditTablePanel>();
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ) {
        const key = `${database || 'default'}.${schema}.${tableName}`;
        
        // If we already have a panel for this table, show it
        if (EditTablePanel.currentPanels.has(key)) {
            const existingPanel = EditTablePanel.currentPanels.get(key)!;
            existingPanel.panel.reveal();
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'editTable',
            `Edit Table: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        EditTablePanel.currentPanels.set(key, new EditTablePanel(panel, context, stateService, schema, tableName, database));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schema: string,
        private tableName: string,
        private database?: string
    ) {
        this.panel = panel;
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.html = this.getWebviewContent();

        // Set up message handling
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        // Load existing table structure
        this.loadTableStructure();
    }

    private async loadTableStructure() {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            const sqlService = new SqlQueryService(this.stateService, this.context);
            const schemaService = new SchemaService(this.stateService, this.context);
            
            // Get columns
            const columns = await schemaService.getColumns(this.database || 'postgres', this.schema, this.tableName);
            
            // Get current table owner
            const ownerQuery = `
                SELECT tableowner as owner
                FROM pg_tables
                WHERE schemaname = $1 AND tablename = $2;
            `;
            const ownerResult = await sqlService.executeQuery(ownerQuery, [this.schema, this.tableName], this.database);
            const currentOwner = ownerResult.rows[0]?.owner || '';
            
            // Get roles from database (excluding system roles and neon-specific roles)
            const rolesQuery = `
                SELECT rolname 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%' 
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                  AND pg_has_role(current_user, oid, 'MEMBER')
                ORDER BY rolname;
            `;
            const rolesResult = await sqlService.executeQuery(rolesQuery, this.database);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);
            
            // Get current user
            const currentUserResult = await sqlService.executeQuery('SELECT current_user', this.database);
            const currentUser = currentUserResult.rows[0]?.current_user || '';
            
            // Transform columns to the format expected by the UI
            const columnData = columns.map(col => ({
                name: col.name,
                dataType: col.metadata.data_type,
                length: col.metadata.character_maximum_length,
                nullable: col.metadata.is_nullable,
                defaultValue: col.metadata.column_default || '',
                isPrimaryKey: col.metadata.is_primary_key,
                isUnique: false, // We'd need to query indexes for this
                comment: ''
            }));

            this.sendMessage({
                command: 'initialize',
                schema: this.schema,
                tableName: this.tableName,
                columns: columnData,
                database: this.database,
                currentOwner,
                existingRoles,
                currentUser
            });
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to load table structure: ${errorMessage}`);
            this.sendMessage({
                command: 'error',
                error: errorMessage
            });
        } finally {
            this.sendMessage({ command: 'loading', loading: false });
        }
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'applyChanges':
                await this.applyChanges(message.changes, message.newTableName, message.newOwner);
                break;

            case 'previewSql':
                const sql = this.generateAlterTableSql(message.changes, message.newTableName, message.newOwner);
                this.sendMessage({
                    command: 'sqlPreview',
                    sql
                });
                break;

            case 'cancel':
                this.panel.dispose();
                break;
        }
    }

    private generateAlterTableSql(changes: ColumnChange[], newTableName?: string, newOwner?: string): string {
        if ((!changes || changes.length === 0) && !newTableName && !newOwner) {
            return '-- No changes to apply';
        }

        const sqlStatements: string[] = [];
        const fullTableName = `${this.schema}.${this.tableName}`;

        changes.forEach(change => {
            switch (change.action) {
                case 'add':
                    let addColDef = `ALTER TABLE ${fullTableName}\n  ADD COLUMN ${change.newName} ${change.dataType.toUpperCase()}`;
                    
                    if (change.length && (
                        change.dataType.toLowerCase().includes('varchar') ||
                        change.dataType.toLowerCase().includes('char') ||
                        change.dataType.toLowerCase().includes('decimal') ||
                        change.dataType.toLowerCase().includes('numeric')
                    )) {
                        addColDef += `(${change.length})`;
                    }

                    if (!change.nullable) {
                        addColDef += ' NOT NULL';
                    }

                    if (change.defaultValue) {
                        addColDef += ` DEFAULT ${change.defaultValue}`;
                    }

                    if (change.isUnique) {
                        addColDef += ' UNIQUE';
                    }

                    addColDef += ';';
                    sqlStatements.push(addColDef);

                    if (change.isPrimaryKey) {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ADD PRIMARY KEY (${change.newName});`);
                    }
                    break;

                case 'modify':
                    // Column modifications require multiple statements
                    if (change.oldName && change.oldName !== change.newName) {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  RENAME COLUMN ${change.oldName} TO ${change.newName};`);
                    }

                    const colName = change.newName;
                    
                    // Change data type
                    let typeChange = `ALTER TABLE ${fullTableName}\n  ALTER COLUMN ${colName} TYPE ${change.dataType.toUpperCase()}`;
                    if (change.length && (
                        change.dataType.toLowerCase().includes('varchar') ||
                        change.dataType.toLowerCase().includes('char')
                    )) {
                        typeChange += `(${change.length})`;
                    }
                    typeChange += ';';
                    sqlStatements.push(typeChange);

                    // Change nullable
                    if (change.nullable) {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN ${colName} DROP NOT NULL;`);
                    } else {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN ${colName} SET NOT NULL;`);
                    }

                    // Change default
                    if (change.defaultValue) {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN ${colName} SET DEFAULT ${change.defaultValue};`);
                    } else {
                        sqlStatements.push(`ALTER TABLE ${fullTableName}\n  ALTER COLUMN ${colName} DROP DEFAULT;`);
                    }
                    break;

                case 'drop':
                    sqlStatements.push(`ALTER TABLE ${fullTableName}\n  DROP COLUMN ${change.oldName || change.newName};`);
                    break;
            }

            if (change.comment) {
                sqlStatements.push(`COMMENT ON COLUMN ${fullTableName}.${change.newName} IS '${change.comment.replace(/'/g, "''")}';`);
            }
        });

        // Handle table rename
        if (newTableName && newTableName !== this.tableName) {
            sqlStatements.push(`ALTER TABLE ${fullTableName}\n  RENAME TO ${newTableName};`);
        }

        // Handle owner change
        if (newOwner) {
            const targetTableName = newTableName || this.tableName;
            sqlStatements.push(`ALTER TABLE ${this.schema}.${targetTableName}\n  OWNER TO "${newOwner}";`);
        }

        return sqlStatements.join('\n\n');
    }

    private async applyChanges(changes: ColumnChange[], newTableName?: string, newOwner?: string) {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            if ((!changes || changes.length === 0) && !newTableName && !newOwner) {
                vscode.window.showInformationMessage('No changes to apply.');
                return;
            }

            const sql = this.generateAlterTableSql(changes, newTableName, newOwner);
            const sqlService = new SqlQueryService(this.stateService, this.context);
            
            // Execute all ALTER statements
            const statements = sql.split(';').filter(s => s.trim());
            for (const statement of statements) {
                if (statement.trim()) {
                    await sqlService.executeQuery(statement.trim() + ';', this.database);
                }
            }

            vscode.window.showInformationMessage(`Table "${this.schema}.${this.tableName}" updated successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
            // Close the panel
            this.panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to update table: ${errorMessage}`);
            this.sendMessage({
                command: 'error',
                error: errorMessage
            });
        } finally {
            this.sendMessage({ command: 'loading', loading: false });
        }
    }

    private sendMessage(message: any) {
        this.panel.webview.postMessage(message);
    }

    private extractErrorMessage(error: any): string {
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

    private getWebviewContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Table</title>
    ${getStyles()}
    <style>
        /* Table-specific styles */
        .container {
            max-width: 1200px;
        }

        .columns-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
        }

        .columns-table th,
        .columns-table td {
            padding: 8px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .columns-table th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
            white-space: nowrap;
        }

        .columns-table input[type="text"],
        .columns-table input[type="number"],
        .columns-table select {
            width: 100%;
            padding: 4px 6px;
            font-size: 12px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
        }

        .columns-table input[type="checkbox"] {
            cursor: pointer;
        }

        .sql-preview {
            max-height: 400px;
        }

        .column-row {
            background-color: var(--vscode-editor-background);
        }

        .column-row:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .column-row.modified {
            background-color: rgba(255, 200, 0, 0.1);
        }

        .column-row.new {
            background-color: rgba(0, 200, 100, 0.1);
        }

        .column-row.deleted {
            background-color: rgba(255, 50, 50, 0.1);
            text-decoration: line-through;
            opacity: 0.6;
        }

        .icon-btn {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px;
            border-radius: 3px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        }

        .icon-btn:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }

        .icon-btn.delete:hover {
            color: var(--vscode-errorForeground);
        }

        .table-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }

        .advanced-toggle-btn {
            background: transparent;
            color: var(--vscode-textLink-foreground);
            border: none;
            padding: 0;
            cursor: pointer;
            font-size: 12px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
        }

        .advanced-toggle-btn:hover {
            background: transparent;
            color: var(--vscode-textLink-activeForeground);
        }

        .advanced-toggle-btn:focus {
            outline: none;
            border: none;
            background: transparent;
        }

        .table-wrapper {
            overflow-x: auto;
            max-width: 100%;
        }

        .advanced-column {
            display: none;
        }

        .show-advanced .advanced-column {
            display: table-cell;
        }

        .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 500;
            margin-left: 8px;
        }

        .status-badge.new {
            background-color: var(--vscode-charts-green);
            color: var(--vscode-editor-background);
        }

        .status-badge.modified {
            background-color: var(--vscode-charts-orange);
            color: var(--vscode-editor-background);
        }

        .status-badge.deleted {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .loading {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .toggle-icon.expanded {
            transform: rotate(90deg);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit Table Schema</h1>
        
        <div id="errorContainer"></div>
        <div id="loadingContainer" class="loading" style="display: none;">Loading table structure...</div>

        <div id="mainContent" style="display: none;">
            <div class="section-box">
                <div class="form-group">
                    <label>Schema</label>
                    <input type="text" id="schemaInput" readonly />
                    <div class="info-text">The schema containing this table</div>
                </div>

                <div class="form-group">
                    <label>Table Name</label>
                    <input type="text" id="tableNameInput" />
                    <div class="info-text">Renaming the table will be included in the ALTER TABLE statements</div>
                </div>

                <div class="form-group">
                    <label>Owner</label>
                    <select id="ownerInput">
                        <option value="">Loading...</option>
                    </select>
                    <div class="info-text">The role that owns this table</div>
                </div>
            </div>

            <div class="section-box">
                <div class="table-controls">
                    <div style="font-weight: 500;">Columns</div>
                    <button class="advanced-toggle-btn" id="advancedToggleBtn">
                        <span id="toggleIcon">▶</span> Show Advanced Options
                    </button>
                </div>

                <div class="table-wrapper">
                    <table class="columns-table" id="columnsTable">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Column Name</th>
                                <th>Data Type</th>
                                <th>Nullable</th>
                                <th>Unique</th>
                                <th>Primary Key</th>
                                <th class="advanced-column">Length</th>
                                <th class="advanced-column">Default</th>
                                <th class="advanced-column">Comment</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="columnsTableBody">
                            <!-- Columns will be added dynamically -->
                        </tbody>
                    </table>
                </div>

                <button class="btn btn-secondary" id="addColumnBtn" style="margin-top: 12px;">+ Add New Column</button>
            </div>

            <div class="section-box collapsible">
                <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                    <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                    SQL Preview
                </div>
                <div class="collapsible-content" id="sqlPreviewSection">
                    <pre class="sql-preview" id="sqlPreview">-- Make changes to see the ALTER TABLE statements</pre>
                </div>
            </div>

            <div class="actions">
                <button class="btn" id="applyBtn">Apply Changes</button>
                <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        let originalColumns = [];
        let columns = [];
        let columnIdCounter = 0;

        // Common PostgreSQL data types
        const dataTypes = [
            'INTEGER', 'BIGINT', 'SMALLINT',
            'SERIAL', 'BIGSERIAL',
            'NUMERIC', 'DECIMAL', 'REAL', 'DOUBLE PRECISION',
            'VARCHAR', 'CHAR', 'TEXT',
            'BOOLEAN',
            'DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ',
            'UUID',
            'JSON', 'JSONB',
            'BYTEA',
            'INET', 'CIDR', 'MACADDR',
            'ARRAY'
        ];

        // Elements
        const errorContainer = document.getElementById('errorContainer');
        const loadingContainer = document.getElementById('loadingContainer');
        const mainContent = document.getElementById('mainContent');
        const schemaInput = document.getElementById('schemaInput');
        const tableNameInput = document.getElementById('tableNameInput');
        const ownerInput = document.getElementById('ownerInput');
        const columnsTableBody = document.getElementById('columnsTableBody');
        const addColumnBtn = document.getElementById('addColumnBtn');
        const sqlPreview = document.getElementById('sqlPreview');
        const applyBtn = document.getElementById('applyBtn');
        const cancelBtn = document.getElementById('cancelBtn');

        let originalTableName = '';
        let originalOwner = '';

        // Event listeners
        addColumnBtn.addEventListener('click', addNewColumn);
        applyBtn.addEventListener('click', applyChanges);
        cancelBtn.addEventListener('click', cancel);
        document.getElementById('advancedToggleBtn').addEventListener('click', toggleAdvancedColumns);
        tableNameInput.addEventListener('input', updatePreview);
        ownerInput.addEventListener('change', updatePreview);

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
        
        // Make toggleSection available globally
        window.toggleSection = toggleSection;

        // Message handling
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'initialize':
                    schemaInput.value = message.schema || 'public';
                    tableNameInput.value = message.tableName || '';
                    originalTableName = message.tableName || '';
                    originalOwner = message.currentOwner || '';
                    
                    // Populate owner dropdown
                    ownerInput.innerHTML = '';
                    if (message.existingRoles && message.existingRoles.length > 0) {
                        message.existingRoles.forEach(role => {
                            const option = document.createElement('option');
                            option.value = role;
                            option.textContent = role;
                            // Select the current owner by default
                            if (role === message.currentOwner) {
                                option.selected = true;
                            }
                            ownerInput.appendChild(option);
                        });
                    }
                    
                    originalColumns = JSON.parse(JSON.stringify(message.columns));
                    columns = message.columns.map((col, index) => ({
                        ...col,
                        id: columnIdCounter++,
                        originalName: col.name,
                        status: 'existing',
                        isDeleted: false
                    }));
                    renderColumns();
                    updatePreview();
                    loadingContainer.style.display = 'none';
                    mainContent.style.display = 'block';
                    break;
                    
                case 'sqlPreview':
                    sqlPreview.textContent = message.sql;
                    break;
                    
                case 'loading':
                    applyBtn.disabled = message.loading;
                    addColumnBtn.disabled = message.loading;
                    if (message.loading) {
                        loadingContainer.style.display = 'block';
                    }
                    break;
                    
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function addNewColumn() {
            const columnId = columnIdCounter++;
            
            const column = {
                id: columnId,
                name: '',
                originalName: null,
                dataType: 'INTEGER',
                length: '',
                nullable: true,
                isPrimaryKey: false,
                isUnique: false,
                defaultValue: '',
                comment: '',
                status: 'new',
                isDeleted: false
            };
            
            columns.push(column);
            renderColumns();
            updatePreview();
        }

        function markColumnAsDeleted(columnId) {
            const column = columns.find(col => col.id === columnId);
            if (column && column.status === 'existing') {
                column.isDeleted = !column.isDeleted;
                renderColumns();
                updatePreview();
            }
        }

        function removeNewColumn(columnId) {
            columns = columns.filter(col => col.id !== columnId);
            renderColumns();
            updatePreview();
        }

        function renderColumns() {
            if (columns.length === 0) {
                columnsTableBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">No columns defined.</td></tr>';
                return;
            }

            columnsTableBody.innerHTML = '';
            
            columns.forEach((col, index) => {
                const row = document.createElement('tr');
                row.className = 'column-row';
                
                if (col.status === 'new') {
                    row.classList.add('new');
                } else if (col.isDeleted) {
                    row.classList.add('deleted');
                } else if (hasColumnChanged(col)) {
                    row.classList.add('modified');
                }

                // Status
                const statusCell = document.createElement('td');
                let statusBadge = '';
                if (col.status === 'new') {
                    statusBadge = '<span class="status-badge new">NEW</span>';
                } else if (col.isDeleted) {
                    statusBadge = '<span class="status-badge deleted">DELETE</span>';
                } else if (hasColumnChanged(col)) {
                    statusBadge = '<span class="status-badge modified">MODIFIED</span>';
                }
                statusCell.innerHTML = statusBadge;
                row.appendChild(statusCell);

                // Column Name
                const nameCell = document.createElement('td');
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.value = col.name;
                nameInput.placeholder = 'column_name';
                nameInput.disabled = col.isDeleted;
                nameInput.addEventListener('input', (e) => {
                    col.name = e.target.value;
                    updatePreview();
                });
                nameCell.appendChild(nameInput);
                row.appendChild(nameCell);

                // Data Type
                const typeCell = document.createElement('td');
                const typeSelect = document.createElement('select');
                typeSelect.disabled = col.isDeleted;
                dataTypes.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (type === col.dataType.toUpperCase()) {
                        option.selected = true;
                    }
                    typeSelect.appendChild(option);
                });
                typeSelect.addEventListener('change', (e) => {
                    col.dataType = e.target.value;
                    updateStatusBadge(row, col);
                    updatePreview();
                });
                typeCell.appendChild(typeSelect);
                row.appendChild(typeCell);

                // Nullable
                const nullableCell = document.createElement('td');
                nullableCell.style.textAlign = 'center';
                const nullableCheckbox = document.createElement('input');
                nullableCheckbox.type = 'checkbox';
                nullableCheckbox.checked = col.nullable;
                nullableCheckbox.disabled = col.isDeleted;
                nullableCheckbox.addEventListener('change', (e) => {
                    col.nullable = e.target.checked;
                    updateStatusBadge(row, col);
                    updatePreview();
                });
                nullableCell.appendChild(nullableCheckbox);
                row.appendChild(nullableCell);

                // Unique
                const uniqueCell = document.createElement('td');
                uniqueCell.style.textAlign = 'center';
                const uniqueCheckbox = document.createElement('input');
                uniqueCheckbox.type = 'checkbox';
                uniqueCheckbox.checked = col.isUnique;
                uniqueCheckbox.disabled = col.isDeleted;
                uniqueCheckbox.addEventListener('change', (e) => {
                    col.isUnique = e.target.checked;
                    updateStatusBadge(row, col);
                    updatePreview();
                });
                uniqueCell.appendChild(uniqueCheckbox);
                row.appendChild(uniqueCell);

                // Primary Key
                const pkCell = document.createElement('td');
                pkCell.style.textAlign = 'center';
                const pkCheckbox = document.createElement('input');
                pkCheckbox.type = 'checkbox';
                pkCheckbox.checked = col.isPrimaryKey;
                pkCheckbox.disabled = col.isDeleted || col.status === 'existing'; // Can't modify PK on existing
                pkCheckbox.addEventListener('change', (e) => {
                    col.isPrimaryKey = e.target.checked;
                    if (e.target.checked) {
                        col.nullable = false;
                        nullableCheckbox.checked = false;
                    }
                    updateStatusBadge(row, col);
                    updatePreview();
                });
                pkCell.appendChild(pkCheckbox);
                row.appendChild(pkCell);

                // Length (Advanced)
                const lengthCell = document.createElement('td');
                lengthCell.className = 'advanced-column';
                const lengthInput = document.createElement('input');
                lengthInput.type = 'number';
                lengthInput.value = col.length || '';
                lengthInput.placeholder = '255';
                lengthInput.min = '1';
                lengthInput.style.width = '80px';
                lengthInput.disabled = col.isDeleted;
                lengthInput.addEventListener('input', (e) => {
                    col.length = e.target.value ? parseInt(e.target.value) : undefined;
                    updateStatusBadge(row, col);
                    updatePreview();
                });
                lengthCell.appendChild(lengthInput);
                row.appendChild(lengthCell);

                // Default Value (Advanced)
                const defaultCell = document.createElement('td');
                defaultCell.className = 'advanced-column';
                const defaultInput = document.createElement('input');
                defaultInput.type = 'text';
                defaultInput.value = col.defaultValue || '';
                defaultInput.placeholder = 'NULL';
                defaultInput.disabled = col.isDeleted;
                defaultInput.addEventListener('input', (e) => {
                    col.defaultValue = e.target.value;
                    updateStatusBadge(row, col);
                    updatePreview();
                });
                defaultCell.appendChild(defaultInput);
                row.appendChild(defaultCell);

                // Comment (Advanced)
                const commentCell = document.createElement('td');
                commentCell.className = 'advanced-column';
                const commentInput = document.createElement('input');
                commentInput.type = 'text';
                commentInput.value = col.comment || '';
                commentInput.placeholder = 'Description';
                commentInput.disabled = col.isDeleted;
                commentInput.addEventListener('input', (e) => {
                    col.comment = e.target.value;
                    updateStatusBadge(row, col);
                    updatePreview();
                });
                commentCell.appendChild(commentInput);
                row.appendChild(commentCell);

                // Actions
                const actionsCell = document.createElement('td');
                actionsCell.style.textAlign = 'center';
                
                if (col.status === 'new') {
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'icon-btn delete';
                    removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1.5v1h-4v1h1v9.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V3.5h1v-1h-4v-1h-3zm-2.5 2h8v9.5h-8V3.5zm2 1.5v6h1v-6h-1zm3 0v6h1v-6h-1z" fill="currentColor"/></svg>';
                    removeBtn.title = 'Remove new column';
                    removeBtn.addEventListener('click', () => removeNewColumn(col.id));
                    actionsCell.appendChild(removeBtn);
                } else {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'icon-btn delete';
                    deleteBtn.innerHTML = col.isDeleted ? '↶' : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1.5v1h-4v1h1v9.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V3.5h1v-1h-4v-1h-3zm-2.5 2h8v9.5h-8V3.5zm2 1.5v6h1v-6h-1zm3 0v6h1v-6h-1z" fill="currentColor"/></svg>';
                    deleteBtn.title = col.isDeleted ? 'Restore column' : 'Mark for deletion';
                    deleteBtn.addEventListener('click', () => markColumnAsDeleted(col.id));
                    actionsCell.appendChild(deleteBtn);
                }
                
                row.appendChild(actionsCell);

                columnsTableBody.appendChild(row);
            });
        }

        function toggleAdvancedColumns() {
            const table = document.getElementById('columnsTable');
            const toggleIcon = document.getElementById('toggleIcon');
            const toggleBtn = document.getElementById('advancedToggleBtn');
            
            if (table.classList.contains('show-advanced')) {
                table.classList.remove('show-advanced');
                toggleIcon.textContent = '▶';
                toggleBtn.innerHTML = '<span id="toggleIcon">▶</span> Show Advanced Options';
            } else {
                table.classList.add('show-advanced');
                toggleIcon.textContent = '▼';
                toggleBtn.innerHTML = '<span id="toggleIcon">▼</span> Hide Advanced Options';
            }
        }

        function hasColumnChanged(col) {
            if (col.status === 'new' || col.isDeleted) {
                return false;
            }

            const original = originalColumns.find(c => c.name === col.originalName);
            if (!original) return true;

            return col.name !== original.name ||
                   col.dataType.toUpperCase() !== original.dataType.toUpperCase() ||
                   col.length !== original.length ||
                   col.nullable !== original.nullable ||
                   col.defaultValue !== (original.defaultValue || '');
        }

        function updateStatusBadge(row, col) {
            // Update row classes
            row.className = 'column-row';
            if (col.status === 'new') {
                row.classList.add('new');
            } else if (col.isDeleted) {
                row.classList.add('deleted');
            } else if (hasColumnChanged(col)) {
                row.classList.add('modified');
            }

            // Update status badge
            const statusCell = row.querySelector('td:first-child');
            if (statusCell) {
                let statusBadge = '';
                if (col.status === 'new') {
                    statusBadge = '<span class="status-badge new">NEW</span>';
                } else if (col.isDeleted) {
                    statusBadge = '<span class="status-badge deleted">DELETE</span>';
                } else if (hasColumnChanged(col)) {
                    statusBadge = '<span class="status-badge modified">MODIFIED</span>';
                }
                statusCell.innerHTML = statusBadge;
            }
        }

        function getChanges() {
            const changes = [];

            columns.forEach(col => {
                if (col.status === 'new' && !col.isDeleted) {
                    // New column
                    changes.push({
                        action: 'add',
                        newName: col.name,
                        dataType: col.dataType,
                        length: col.length,
                        nullable: col.nullable,
                        defaultValue: col.defaultValue,
                        isPrimaryKey: col.isPrimaryKey,
                        isUnique: col.isUnique,
                        comment: col.comment
                    });
                } else if (col.status === 'existing' && col.isDeleted) {
                    // Column to delete
                    changes.push({
                        action: 'drop',
                        oldName: col.originalName,
                        newName: col.name
                    });
                } else if (col.status === 'existing' && !col.isDeleted && hasColumnChanged(col)) {
                    // Modified column
                    changes.push({
                        action: 'modify',
                        oldName: col.originalName,
                        newName: col.name,
                        dataType: col.dataType,
                        length: col.length,
                        nullable: col.nullable,
                        defaultValue: col.defaultValue,
                        isPrimaryKey: col.isPrimaryKey,
                        isUnique: col.isUnique,
                        comment: col.comment
                    });
                }
            });

            return changes;
        }

        function updatePreview() {
            const changes = getChanges();
            const newTableName = tableNameInput.value.trim();
            const newOwner = ownerInput.value;
            const tableRenamed = newTableName !== originalTableName;
            const ownerChanged = newOwner !== originalOwner;
            
            if (changes.length === 0 && !tableRenamed && !ownerChanged) {
                sqlPreview.textContent = '-- No changes to apply';
                return;
            }

            vscode.postMessage({
                command: 'previewSql',
                changes: changes,
                newTableName: tableRenamed ? newTableName : undefined,
                newOwner: ownerChanged ? newOwner : undefined
            });
        }

        function applyChanges() {
            const changes = getChanges();
            const newTableName = tableNameInput.value.trim();
            const newOwner = ownerInput.value;
            const tableRenamed = newTableName !== originalTableName;
            const ownerChanged = newOwner !== originalOwner;
            
            if (changes.length === 0 && !tableRenamed && !ownerChanged) {
                showError('No changes to apply');
                return;
            }

            // Validate changes
            for (const change of changes) {
                if ((change.action === 'add' || change.action === 'modify') && !change.newName) {
                    showError('Column name is required');
                    return;
                }
                
                if ((change.action === 'add' || change.action === 'modify') && !change.dataType) {
                    showError(\`Data type is required for column "\${change.newName}"\`);
                    return;
                }
            }

            vscode.postMessage({
                command: 'applyChanges',
                changes: changes,
                newTableName: tableRenamed ? newTableName : undefined,
                newOwner: ownerChanged ? newOwner : undefined
            });
        }

        function cancel() {
            vscode.postMessage({
                command: 'cancel'
            });
        }

        function showError(message) {
            errorContainer.innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }
    </script>
</body>
</html>`;
    }

    private getKey(): string {
        return `${this.database || 'default'}.${this.schema}.${this.tableName}`;
    }

    public dispose() {
        const key = this.getKey();
        EditTablePanel.currentPanels.delete(key);
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}


