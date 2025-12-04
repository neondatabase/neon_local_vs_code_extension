import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { getStyles } from '../templates/styles';

export interface ColumnDefinition {
    name: string;
    dataType: string;
    length?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey: boolean;
    isUnique: boolean;
    comment?: string;
}

export interface TableDefinition {
    schema: string;
    tableName: string;
    owner?: string;
    columns: ColumnDefinition[];
}

export class CreateTablePanel {
    public static currentPanel: CreateTablePanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    public static createOrShow(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        database?: string
    ) {
        // If we already have a panel, show it
        if (CreateTablePanel.currentPanel) {
            CreateTablePanel.currentPanel.panel.reveal();
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            'createTable',
            'Create Table',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        CreateTablePanel.currentPanel = new CreateTablePanel(panel, context, stateService, schema, database);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private schema: string,
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

        // Load initial data
        this.loadInitialData();
    }

    private async loadInitialData() {
        try {
            const sqlService = new SqlQueryService(this.stateService, this.context);
            
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

            this.sendMessage({
                command: 'initialize',
                schema: this.schema,
                database: this.database,
                existingRoles,
                currentUser
            });
        } catch (error) {
            console.error('Failed to load initial data:', error);
            this.sendMessage({
                command: 'initialize',
                schema: this.schema,
                database: this.database,
                existingRoles: [],
                currentUser: ''
            });
        }
    }

    private async handleMessage(message: any) {
        switch (message.command) {
            case 'createTable':
                await this.createTable(message.tableDefinition);
                break;

            case 'previewSql':
                const sql = this.generateCreateTableSql(message.tableDefinition);
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

    /**
     * Quote a PostgreSQL identifier to preserve case and handle special characters
     */
    private quoteIdentifier(identifier: string): string {
        // Escape any double quotes by doubling them
        const escaped = identifier.replace(/"/g, '""');
        // Wrap in double quotes
        return `"${escaped}"`;
    }

    private generateCreateTableSql(tableDef: TableDefinition): string {
        const { schema, tableName, columns, owner } = tableDef;
        
        if (!tableName || columns.length === 0) {
            return '-- Invalid table definition';
        }

        let sql = `CREATE TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(tableName)} (\n`;
        
        const columnDefs: string[] = [];
        const constraints: string[] = [];

        // Generate column definitions
        columns.forEach((col, index) => {
            if (!col.name || !col.dataType) {
                return;
            }

            let colDef = `    ${this.quoteIdentifier(col.name)} ${col.dataType.toUpperCase()}`;
            
            // Add length/precision for types that support it
            if (col.length && (
                col.dataType.toLowerCase().includes('varchar') ||
                col.dataType.toLowerCase().includes('char') ||
                col.dataType.toLowerCase().includes('decimal') ||
                col.dataType.toLowerCase().includes('numeric')
            )) {
                colDef += `(${col.length})`;
            }

            // Add NOT NULL constraint
            if (!col.nullable) {
                colDef += ' NOT NULL';
            }

            // Add DEFAULT value
            if (col.defaultValue) {
                colDef += ` DEFAULT ${col.defaultValue}`;
            }

            // Add UNIQUE constraint
            if (col.isUnique && !col.isPrimaryKey) {
                colDef += ' UNIQUE';
            }

            columnDefs.push(colDef);

            // Track primary keys for constraint
            if (col.isPrimaryKey) {
                constraints.push(this.quoteIdentifier(col.name));
            }
        });

        sql += columnDefs.join(',\n');

        // Add primary key constraint
        if (constraints.length > 0) {
            sql += `,\n    PRIMARY KEY (${constraints.join(', ')})`;
        }

        sql += '\n);';

        // Add column comments if any
        columns.forEach(col => {
            if (col.comment) {
                sql += `\n\nCOMMENT ON COLUMN ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(tableName)}.${this.quoteIdentifier(col.name)} IS '${col.comment.replace(/'/g, "''")}';`;
            }
        });

        // Add owner if specified
        if (owner) {
            sql += `\n\nALTER TABLE ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(tableName)} OWNER TO "${owner}";`;
        }

        return sql;
    }

    private async createTable(tableDef: TableDefinition) {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            const sql = this.generateCreateTableSql(tableDef);
            const sqlService = new SqlQueryService(this.stateService, this.context);
            
            await sqlService.executeQuery(sql, this.database);

            vscode.window.showInformationMessage(`Table "${tableDef.schema}.${tableDef.tableName}" created successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
            // Close the panel
            this.panel.dispose();
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to create table: ${errorMessage}`);
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
    <title>Create Table</title>
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
        }

        .columns-table input[type="text"],
        .columns-table input[type="number"],
        .columns-table select {
            width: 100%;
            padding: 4px 6px;
            font-size: 12px;
        }

        .columns-table input[type="checkbox"] {
            cursor: pointer;
        }

        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }

        .btn-small {
            padding: 4px 8px;
            font-size: 12px;
        }

        .column-row {
            background-color: var(--vscode-editor-background);
        }

        .column-row:hover {
            background-color: var(--vscode-list-hoverBackground);
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
    </style>
</head>
<body>
    <div class="container">
        <h1>Create Table</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema</label>
                <input type="text" id="schemaInput" readonly />
                <div class="info-text">The schema where this table will be created</div>
            </div>

            <div class="form-group">
                <label>Table Name <span class="required">*</span></label>
                <input type="text" id="tableNameInput" placeholder="users" />
                <div class="info-text">Must start with a letter and contain only letters, numbers, and underscores</div>
            </div>

            <div class="form-group">
                <label>Owner</label>
                <select id="ownerInput">
                    <option value="">Loading...</option>
                </select>
                <div class="info-text">The role that will own this table</div>
            </div>
        </div>

        <div class="section-box">
            <div class="table-controls">
                <div>
                    <div style="font-weight: 500;">Columns</div>
                    <div class="info-text" style="margin-top: 4px;">Define the columns for your table. At least one column is required.</div>
                </div>
                <button class="advanced-toggle-btn" id="advancedToggleBtn">
                    <span id="toggleIcon">▶</span> Show Advanced Options
                </button>
            </div>

            <div class="table-wrapper">
                    <table class="columns-table" id="columnsTable">
                        <thead>
                            <tr>
                                <th>Column Name <span class="required">*</span></th>
                                <th>Data Type <span class="required">*</span></th>
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

            <button class="btn btn-secondary" id="addColumnBtn" style="margin-top: 12px;">+ Add Column</button>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <div class="sql-preview" id="sqlPreview">-- Generating SQL preview...</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create Table</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
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
        const schemaInput = document.getElementById('schemaInput');
        const tableNameInput = document.getElementById('tableNameInput');
        const ownerInput = document.getElementById('ownerInput');
        const columnsTableBody = document.getElementById('columnsTableBody');
        const addColumnBtn = document.getElementById('addColumnBtn');
        const sqlPreview = document.getElementById('sqlPreview');
        const createBtn = document.getElementById('createBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        // Event listeners
        addColumnBtn.addEventListener('click', () => addColumn());
        createBtn.addEventListener('click', createTable);
        cancelBtn.addEventListener('click', cancel);
        document.getElementById('advancedToggleBtn').addEventListener('click', toggleAdvancedColumns);
        tableNameInput.addEventListener('input', updatePreview);
        ownerInput.addEventListener('change', updatePreview);

        // Message handling
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'initialize':
                    schemaInput.value = message.schema || 'public';
                    
                    // Populate owner dropdown
                    ownerInput.innerHTML = '';
                    if (message.existingRoles && message.existingRoles.length > 0) {
                        message.existingRoles.forEach(role => {
                            const option = document.createElement('option');
                            option.value = role;
                            option.textContent = role;
                            // Select the current user by default
                            if (role === message.currentUser) {
                                option.selected = true;
                            }
                            ownerInput.appendChild(option);
                        });
                    }
                    
                    // Add default 'id' column
                    addColumn('id', 'SERIAL', false, true, false);
                    updatePreview(); // Generate initial preview
                    break;
                    
                case 'sqlPreview':
                    sqlPreview.textContent = message.sql;
                    break;
                    
                case 'loading':
                    createBtn.disabled = message.loading;
                    addColumnBtn.disabled = message.loading;
                    break;
                    
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function addColumn(name = '', dataType = 'INTEGER', nullable = true, isPrimaryKey = false, isUnique = false) {
            const columnId = columnIdCounter++;
            
            const column = {
                id: columnId,
                name: name,
                dataType: dataType,
                length: '',
                nullable: nullable,
                isPrimaryKey: isPrimaryKey,
                isUnique: isUnique,
                defaultValue: '',
                comment: ''
            };
            
            columns.push(column);
            renderColumns();
            updatePreview();
        }

        function removeColumn(columnId) {
            columns = columns.filter(col => col.id !== columnId);
            renderColumns();
            updatePreview();
        }

        function renderColumns() {
            if (columns.length === 0) {
                columnsTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--vscode-descriptionForeground); padding: 20px;">No columns defined. Click "Add Column" to add one.</td></tr>';
                return;
            }

            columnsTableBody.innerHTML = '';
            
            columns.forEach((col, index) => {
                // Main row with basic fields
                const row = document.createElement('tr');
                row.className = 'column-row';
                row.id = 'column-row-' + col.id;
                
                // Column Name
                const nameCell = document.createElement('td');
                const nameInput = document.createElement('input');
                nameInput.type = 'text';
                nameInput.value = col.name;
                nameInput.placeholder = 'column_name';
                nameInput.addEventListener('input', (e) => {
                    col.name = e.target.value;
                    updatePreview();
                });
                nameCell.appendChild(nameInput);
                row.appendChild(nameCell);

                // Data Type
                const typeCell = document.createElement('td');
                const typeSelect = document.createElement('select');
                dataTypes.forEach(type => {
                    const option = document.createElement('option');
                    option.value = type;
                    option.textContent = type;
                    if (type === col.dataType) {
                        option.selected = true;
                    }
                    typeSelect.appendChild(option);
                });
                typeSelect.addEventListener('change', (e) => {
                    col.dataType = e.target.value;
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
                nullableCheckbox.addEventListener('change', (e) => {
                    col.nullable = e.target.checked;
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
                uniqueCheckbox.addEventListener('change', (e) => {
                    col.isUnique = e.target.checked;
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
                pkCheckbox.addEventListener('change', (e) => {
                    col.isPrimaryKey = e.target.checked;
                    // Primary keys should not be nullable
                    if (e.target.checked) {
                        col.nullable = false;
                        nullableCheckbox.checked = false;
                    }
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
                lengthInput.addEventListener('input', (e) => {
                    col.length = e.target.value ? parseInt(e.target.value) : undefined;
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
                defaultInput.placeholder = 'NULL, NOW()';
                defaultInput.addEventListener('input', (e) => {
                    col.defaultValue = e.target.value;
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
                commentInput.addEventListener('input', (e) => {
                    col.comment = e.target.value;
                    updatePreview();
                });
                commentCell.appendChild(commentInput);
                row.appendChild(commentCell);

                // Actions
                const actionsCell = document.createElement('td');
                actionsCell.style.textAlign = 'center';
                
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'icon-btn delete';
                deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1.5v1h-4v1h1v9.5a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V3.5h1v-1h-4v-1h-3zm-2.5 2h8v9.5h-8V3.5zm2 1.5v6h1v-6h-1zm3 0v6h1v-6h-1z" fill="currentColor"/></svg>';
                deleteBtn.title = 'Remove column';
                deleteBtn.addEventListener('click', () => removeColumn(col.id));
                actionsCell.appendChild(deleteBtn);
                
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

        function updatePreview() {
            const tableDef = getTableDefinition();
            
            vscode.postMessage({
                command: 'previewSql',
                tableDefinition: tableDef
            });
        }

        function createTable() {
            const tableDef = getTableDefinition();
            
            if (!validateTableDefinition(tableDef)) {
                return;
            }

            vscode.postMessage({
                command: 'createTable',
                tableDefinition: tableDef
            });
        }

        function cancel() {
            vscode.postMessage({
                command: 'cancel'
            });
        }

        function getTableDefinition() {
            return {
                schema: schemaInput.value,
                tableName: tableNameInput.value.trim(),
                owner: ownerInput.value,
                columns: columns.map(col => ({
                    name: col.name.trim(),
                    dataType: col.dataType,
                    length: col.length,
                    nullable: col.nullable,
                    defaultValue: col.defaultValue.trim(),
                    isPrimaryKey: col.isPrimaryKey,
                    isUnique: col.isUnique,
                    comment: col.comment
                }))
            };
        }

        function validateTableDefinition(tableDef) {
            clearError();

            if (!tableDef.tableName) {
                showError('Table name is required');
                return false;
            }

            if (!/^[a-z_][a-z0-9_]*$/i.test(tableDef.tableName)) {
                showError('Table name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }

            if (tableDef.columns.length === 0) {
                showError('At least one column is required');
                return false;
            }

            for (let i = 0; i < tableDef.columns.length; i++) {
                const col = tableDef.columns[i];
                
                if (!col.name) {
                    showError(\`Column #\${i + 1} name is required\`);
                    return false;
                }

                if (!/^[a-z_][a-z0-9_]*$/i.test(col.name)) {
                    showError(\`Column "\${col.name}" must start with a letter and contain only letters, numbers, and underscores\`);
                    return false;
                }

                if (!col.dataType) {
                    showError(\`Column "\${col.name}" data type is required\`);
                    return false;
                }

                // Check for duplicate column names
                const duplicates = tableDef.columns.filter(c => c.name.toLowerCase() === col.name.toLowerCase());
                if (duplicates.length > 1) {
                    showError(\`Duplicate column name: "\${col.name}"\`);
                    return false;
                }
            }

            return true;
        }

        function showError(message) {
            errorContainer.innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }

        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId);
            const icon = document.getElementById('sqlPreviewIcon');
            
            if (content.style.display === 'none' || content.style.display === '') {
                content.style.display = 'block';
                icon.style.transform = 'rotate(90deg)';
            } else {
                content.style.display = 'none';
                icon.style.transform = 'rotate(0deg)';
            }
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        CreateTablePanel.currentPanel = undefined;
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}


