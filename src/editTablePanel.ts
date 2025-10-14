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
            
            const schemaService = new SchemaService(this.stateService, this.context);
            const columns = await schemaService.getColumns(this.database || 'postgres', this.schema, this.tableName);
            
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
                database: this.database
            });
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
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
                await this.applyChanges(message.changes);
                break;

            case 'previewSql':
                const sql = this.generateAlterTableSql(message.changes);
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

    private generateAlterTableSql(changes: ColumnChange[]): string {
        if (!changes || changes.length === 0) {
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

        return sqlStatements.join('\n\n');
    }

    private async applyChanges(changes: ColumnChange[]) {
        try {
            this.sendMessage({ command: 'loading', loading: true });
            
            if (!changes || changes.length === 0) {
                vscode.window.showInformationMessage('No changes to apply.');
                return;
            }

            const sql = this.generateAlterTableSql(changes);
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
            const errorMessage = error instanceof Error ? error.message : String(error);
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
            max-width: 1400px;
        }

        .section {
            margin-bottom: 20px;
        }

        .info-text {
            margin-bottom: 12px;
        }

        .columns-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            overflow-x: auto;
            display: block;
        }

        .columns-table table {
            width: 100%;
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
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit Table Schema</h1>
        
        <div id="errorContainer"></div>
        <div id="loadingContainer" class="loading" style="display: none;">Loading table structure...</div>

        <div id="mainContent" style="display: none;">
            <div class="section">
                <div class="section-title">Table: <span id="tableNameDisplay"></span></div>
                <div class="info-text">Modify existing columns, add new ones, or mark columns for deletion. Changes will be applied as ALTER TABLE statements.</div>
            </div>

            <div class="section">
                <div class="section-title">Columns</div>
                
                <div class="columns-table">
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 8%;">Status</th>
                                <th style="width: 18%;">Column Name</th>
                                <th style="width: 15%;">Data Type</th>
                                <th style="width: 10%;">Length</th>
                                <th style="width: 8%;">Nullable</th>
                                <th style="width: 8%;">PK</th>
                                <th style="width: 8%;">Unique</th>
                                <th style="width: 15%;">Default</th>
                                <th style="width: 10%;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="columnsTableBody">
                            <!-- Columns will be added dynamically -->
                        </tbody>
                    </table>
                </div>

                <button class="btn btn-secondary" id="addColumnBtn" style="margin-top: 12px;">+ Add New Column</button>
            </div>

            <div class="section">
                <div class="section-title">SQL Preview</div>
                <button class="btn btn-secondary" id="previewSqlBtn">Generate SQL Preview</button>
                <div class="sql-preview" id="sqlPreview">-- Click "Generate SQL Preview" to see the ALTER TABLE statements</div>
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
        const tableNameDisplay = document.getElementById('tableNameDisplay');
        const columnsTableBody = document.getElementById('columnsTableBody');
        const addColumnBtn = document.getElementById('addColumnBtn');
        const previewSqlBtn = document.getElementById('previewSqlBtn');
        const sqlPreview = document.getElementById('sqlPreview');
        const applyBtn = document.getElementById('applyBtn');
        const cancelBtn = document.getElementById('cancelBtn');

        // Event listeners
        addColumnBtn.addEventListener('click', addNewColumn);
        previewSqlBtn.addEventListener('click', previewSql);
        applyBtn.addEventListener('click', applyChanges);
        cancelBtn.addEventListener('click', cancel);

        // Message handling
        window.addEventListener('message', (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'initialize':
                    tableNameDisplay.textContent = \`\${message.schema}.\${message.tableName}\`;
                    originalColumns = JSON.parse(JSON.stringify(message.columns));
                    columns = message.columns.map((col, index) => ({
                        ...col,
                        id: columnIdCounter++,
                        originalName: col.name,
                        status: 'existing',
                        isDeleted: false
                    }));
                    renderColumns();
                    loadingContainer.style.display = 'none';
                    mainContent.style.display = 'block';
                    break;
                    
                case 'sqlPreview':
                    sqlPreview.textContent = message.sql;
                    break;
                    
                case 'loading':
                    applyBtn.disabled = message.loading;
                    previewSqlBtn.disabled = message.loading;
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
        }

        function markColumnAsDeleted(columnId) {
            const column = columns.find(col => col.id === columnId);
            if (column && column.status === 'existing') {
                column.isDeleted = !column.isDeleted;
                renderColumns();
            }
        }

        function removeNewColumn(columnId) {
            columns = columns.filter(col => col.id !== columnId);
            renderColumns();
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
                    renderColumns();
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
                    renderColumns();
                });
                typeCell.appendChild(typeSelect);
                row.appendChild(typeCell);

                // Length
                const lengthCell = document.createElement('td');
                const lengthInput = document.createElement('input');
                lengthInput.type = 'number';
                lengthInput.value = col.length || '';
                lengthInput.placeholder = '255';
                lengthInput.min = '1';
                lengthInput.disabled = col.isDeleted;
                lengthInput.addEventListener('input', (e) => {
                    col.length = e.target.value ? parseInt(e.target.value) : undefined;
                    renderColumns();
                });
                lengthCell.appendChild(lengthInput);
                row.appendChild(lengthCell);

                // Nullable
                const nullableCell = document.createElement('td');
                nullableCell.style.textAlign = 'center';
                const nullableCheckbox = document.createElement('input');
                nullableCheckbox.type = 'checkbox';
                nullableCheckbox.checked = col.nullable;
                nullableCheckbox.disabled = col.isDeleted;
                nullableCheckbox.addEventListener('change', (e) => {
                    col.nullable = e.target.checked;
                    renderColumns();
                });
                nullableCell.appendChild(nullableCheckbox);
                row.appendChild(nullableCell);

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
                    }
                    renderColumns();
                });
                pkCell.appendChild(pkCheckbox);
                row.appendChild(pkCell);

                // Unique
                const uniqueCell = document.createElement('td');
                uniqueCell.style.textAlign = 'center';
                const uniqueCheckbox = document.createElement('input');
                uniqueCheckbox.type = 'checkbox';
                uniqueCheckbox.checked = col.isUnique;
                uniqueCheckbox.disabled = col.isDeleted;
                uniqueCheckbox.addEventListener('change', (e) => {
                    col.isUnique = e.target.checked;
                    renderColumns();
                });
                uniqueCell.appendChild(uniqueCheckbox);
                row.appendChild(uniqueCell);

                // Default Value
                const defaultCell = document.createElement('td');
                const defaultInput = document.createElement('input');
                defaultInput.type = 'text';
                defaultInput.value = col.defaultValue || '';
                defaultInput.placeholder = 'NULL';
                defaultInput.disabled = col.isDeleted;
                defaultInput.addEventListener('input', (e) => {
                    col.defaultValue = e.target.value;
                    renderColumns();
                });
                defaultCell.appendChild(defaultInput);
                row.appendChild(defaultCell);

                // Actions
                const actionsCell = document.createElement('td');
                actionsCell.style.textAlign = 'center';
                
                if (col.status === 'new') {
                    const removeBtn = document.createElement('button');
                    removeBtn.className = 'icon-btn delete';
                    removeBtn.innerHTML = '🗑️';
                    removeBtn.title = 'Remove new column';
                    removeBtn.addEventListener('click', () => removeNewColumn(col.id));
                    actionsCell.appendChild(removeBtn);
                } else {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'icon-btn delete';
                    deleteBtn.innerHTML = col.isDeleted ? '↶' : '🗑️';
                    deleteBtn.title = col.isDeleted ? 'Restore column' : 'Mark for deletion';
                    deleteBtn.addEventListener('click', () => markColumnAsDeleted(col.id));
                    actionsCell.appendChild(deleteBtn);
                }
                
                row.appendChild(actionsCell);

                columnsTableBody.appendChild(row);
            });
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

        function previewSql() {
            const changes = getChanges();
            
            if (changes.length === 0) {
                sqlPreview.textContent = '-- No changes to apply';
                return;
            }

            vscode.postMessage({
                command: 'previewSql',
                changes: changes
            });
        }

        function applyChanges() {
            const changes = getChanges();
            
            if (changes.length === 0) {
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
                changes: changes
            });
        }

        function cancel() {
            vscode.postMessage({
                command: 'cancel'
            });
        }

        function showError(message) {
            errorContainer.innerHTML = \`<div class="error">\${message}</div>\`;
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


