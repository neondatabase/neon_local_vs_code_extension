import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { SqlQueryService } from '../services/sqlQuery.service';
import { getStyles } from '../templates/styles';

interface ColumnDefinition {
    name: string;
    dataType: string;
    length?: number;
    precision?: number;
    scale?: number;
    nullable: boolean;
    defaultValue?: string;
    isPrimaryKey?: boolean;
    isUnique?: boolean;
}

export class ColumnManagementPanel {
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
     * Create a new column
     */
    public static async createColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'createColumn',
            `Add Column to ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getCreateColumnHtml(schema, tableName);

        panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'createColumn':
                        await this.executeCreateColumn(
                            context,
                            stateService,
                            schema,
                            tableName,
                            message.columnDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = this.generateCreateColumnSql(schema, tableName, message.columnDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    }

    /**
     * Edit an existing column
     */
    public static async editColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        columnName: string,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'editColumn',
            `Edit Column: ${schema}.${tableName}.${columnName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Fetch current column details
        try {
            const sqlService = new SqlQueryService(stateService, context);
            const result = await sqlService.executeQuery(`
                SELECT 
                    column_name,
                    data_type,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale,
                    is_nullable,
                    column_default,
                    EXISTS(
                        SELECT 1 FROM information_schema.key_column_usage kcu
                        JOIN information_schema.table_constraints tc 
                            ON kcu.constraint_name = tc.constraint_name
                            AND kcu.table_schema = tc.table_schema
                        WHERE kcu.table_schema = $1
                            AND kcu.table_name = $2
                            AND kcu.column_name = $3
                            AND tc.constraint_type = 'PRIMARY KEY'
                    ) as is_primary_key,
                    EXISTS(
                        SELECT 1 FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage kcu 
                            ON tc.constraint_name = kcu.constraint_name
                            AND tc.table_schema = kcu.table_schema
                        WHERE tc.table_schema = $1
                            AND tc.table_name = $2
                            AND kcu.column_name = $3
                            AND tc.constraint_type = 'UNIQUE'
                    ) as is_unique
                FROM information_schema.columns
                WHERE table_schema = $1
                    AND table_name = $2
                    AND column_name = $3
            `, [schema, tableName, columnName], database);

            if (result.rows.length === 0) {
                vscode.window.showErrorMessage(`Column "${columnName}" not found in table "${schema}.${tableName}"`);
                panel.dispose();
                return;
            }

            const currentColumn = result.rows[0];
            panel.webview.html = this.getEditColumnHtml(schema, tableName, columnName, currentColumn);

            panel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                        case 'editColumn':
                            await this.executeEditColumn(
                                context,
                                stateService,
                                schema,
                                tableName,
                                columnName,
                                message.columnDef,
                                currentColumn,
                                database,
                                panel
                            );
                            break;
                        case 'previewSql':
                            const sql = this.generateEditColumnSql(schema, tableName, columnName, message.columnDef, currentColumn);
                            panel.webview.postMessage({ command: 'sqlPreview', sql });
                            break;
                        case 'cancel':
                            panel.dispose();
                            break;
                    }
                },
                undefined,
                context.subscriptions
            );
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to load column details: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop a column
     */
    public static async dropColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        columnName: string,
        database?: string
    ): Promise<void> {
        try {
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop column "${columnName}" from table "${schema}.${tableName}"?`,
                { modal: true },
                'Drop Column'
            );

            if (!confirmation) {
                return;
            }

            const sql = `ALTER TABLE "${schema}"."${tableName}" DROP COLUMN "${columnName}";`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Column "${columnName}" dropped successfully!`);
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
            
            vscode.window.showErrorMessage(`Failed to drop column: ${errorMessage}`);
        }
    }

    /**
     * Execute column creation
     */
    private static async executeCreateColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        columnDef: ColumnDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = this.generateCreateColumnSql(schema, tableName, columnDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Column "${columnDef.name}" created successfully!`);
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
     * Execute column edit
     */
    private static async executeEditColumn(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        oldColumnName: string,
        columnDef: ColumnDefinition,
        currentColumn: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = this.generateEditColumnSql(schema, tableName, oldColumnName, columnDef, currentColumn);
            
            if (!sql || sql === '-- No changes to apply') {
                vscode.window.showInformationMessage('No changes to apply');
                panel.dispose();
                return;
            }

            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Column "${columnDef.name}" updated successfully!`);
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
     * Generate CREATE COLUMN SQL
     */
    private static generateCreateColumnSql(schema: string, tableName: string, columnDef: ColumnDefinition): string {
        const statements: string[] = [];

        // Build column definition
        let columnSpec = `"${columnDef.name}" ${columnDef.dataType.toUpperCase()}`;

        // Add length/precision for applicable types
        if (columnDef.length && ['VARCHAR', 'CHAR', 'CHARACTER'].includes(columnDef.dataType.toUpperCase())) {
            columnSpec += `(${columnDef.length})`;
        } else if (columnDef.precision && ['NUMERIC', 'DECIMAL'].includes(columnDef.dataType.toUpperCase())) {
            if (columnDef.scale !== undefined) {
                columnSpec += `(${columnDef.precision}, ${columnDef.scale})`;
            } else {
                columnSpec += `(${columnDef.precision})`;
            }
        }

        // Add NOT NULL constraint
        if (!columnDef.nullable) {
            columnSpec += ' NOT NULL';
        }

        // Add DEFAULT constraint
        if (columnDef.defaultValue) {
            columnSpec += ` DEFAULT ${columnDef.defaultValue}`;
        }

        // Add UNIQUE constraint
        if (columnDef.isUnique) {
            columnSpec += ' UNIQUE';
        }

        statements.push(`ALTER TABLE "${schema}"."${tableName}" ADD COLUMN ${columnSpec};`);

        // Add PRIMARY KEY constraint separately if needed
        if (columnDef.isPrimaryKey) {
            statements.push(`ALTER TABLE "${schema}"."${tableName}" ADD PRIMARY KEY ("${columnDef.name}");`);
        }

        return statements.join('\n');
    }

    /**
     * Generate EDIT COLUMN SQL
     */
    private static generateEditColumnSql(
        schema: string,
        tableName: string,
        oldColumnName: string,
        columnDef: ColumnDefinition,
        currentColumn: any
    ): string {
        const statements: string[] = [];

        // Check for column rename
        if (columnDef.name !== oldColumnName) {
            statements.push(`ALTER TABLE "${schema}"."${tableName}" RENAME COLUMN "${oldColumnName}" TO "${columnDef.name}";`);
        }

        const targetColumnName = columnDef.name;

        // Check for data type change
        const currentDataType = currentColumn.data_type.toUpperCase();
        const newDataType = columnDef.dataType.toUpperCase();
        
        let typeSpec = newDataType;
        if (columnDef.length && ['VARCHAR', 'CHAR', 'CHARACTER'].includes(newDataType)) {
            typeSpec += `(${columnDef.length})`;
        } else if (columnDef.precision && ['NUMERIC', 'DECIMAL'].includes(newDataType)) {
            if (columnDef.scale !== undefined) {
                typeSpec += `(${columnDef.precision}, ${columnDef.scale})`;
            } else {
                typeSpec += `(${columnDef.precision})`;
            }
        }

        const currentTypeSpec = this.getCurrentTypeSpec(currentColumn);
        if (typeSpec !== currentTypeSpec) {
            statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" TYPE ${typeSpec} USING "${targetColumnName}"::${typeSpec};`);
        }

        // Check for nullable change
        const currentNullable = currentColumn.is_nullable === 'YES';
        if (columnDef.nullable !== currentNullable) {
            if (columnDef.nullable) {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" DROP NOT NULL;`);
            } else {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" SET NOT NULL;`);
            }
        }

        // Check for default value change
        const currentDefault = currentColumn.column_default;
        if (columnDef.defaultValue !== currentDefault) {
            if (columnDef.defaultValue) {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" SET DEFAULT ${columnDef.defaultValue};`);
            } else if (currentDefault) {
                statements.push(`ALTER TABLE "${schema}"."${tableName}" ALTER COLUMN "${targetColumnName}" DROP DEFAULT;`);
            }
        }

        // Note: PRIMARY KEY and UNIQUE constraints are managed separately
        // They require constraint management which is more complex

        return statements.length > 0 ? statements.join('\n') : '-- No changes to apply';
    }

    /**
     * Helper to get current type specification
     */
    private static getCurrentTypeSpec(currentColumn: any): string {
        let typeSpec = currentColumn.data_type.toUpperCase();
        if (currentColumn.character_maximum_length) {
            typeSpec += `(${currentColumn.character_maximum_length})`;
        } else if (currentColumn.numeric_precision) {
            if (currentColumn.numeric_scale !== null && currentColumn.numeric_scale !== undefined) {
                typeSpec += `(${currentColumn.numeric_precision}, ${currentColumn.numeric_scale})`;
            } else {
                typeSpec += `(${currentColumn.numeric_precision})`;
            }
        }
        return typeSpec;
    }

    /**
     * Get HTML for create column panel
     */
    private static getCreateColumnHtml(schema: string, tableName: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Add Column</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Add Column to ${schema}.${tableName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Column Name <span class="required">*</span></label>
                <input type="text" id="columnName" placeholder="my_column" />
                <div class="info-text">Must start with a letter and contain only letters, numbers, and underscores</div>
            </div>

            <div class="form-group">
                <label>Data Type <span class="required">*</span></label>
                <select id="dataType">
                    <optgroup label="Numeric Types">
                        <option value="INTEGER">INTEGER</option>
                        <option value="BIGINT">BIGINT</option>
                        <option value="SMALLINT">SMALLINT</option>
                        <option value="SERIAL">SERIAL</option>
                        <option value="BIGSERIAL">BIGSERIAL</option>
                        <option value="NUMERIC">NUMERIC</option>
                        <option value="DECIMAL">DECIMAL</option>
                        <option value="REAL">REAL</option>
                        <option value="DOUBLE PRECISION">DOUBLE PRECISION</option>
                    </optgroup>
                    <optgroup label="Text Types">
                        <option value="VARCHAR">VARCHAR</option>
                        <option value="CHAR">CHAR</option>
                        <option value="TEXT">TEXT</option>
                    </optgroup>
                    <optgroup label="Date/Time Types">
                        <option value="DATE">DATE</option>
                        <option value="TIME">TIME</option>
                        <option value="TIMESTAMP">TIMESTAMP</option>
                        <option value="TIMESTAMPTZ">TIMESTAMPTZ</option>
                    </optgroup>
                    <optgroup label="Other Types">
                        <option value="BOOLEAN">BOOLEAN</option>
                        <option value="UUID">UUID</option>
                        <option value="JSON">JSON</option>
                        <option value="JSONB">JSONB</option>
                        <option value="BYTEA">BYTEA</option>
                    </optgroup>
                </select>
            </div>

            <div class="form-group" id="lengthGroup" style="display: none;">
                <label>Length</label>
                <input type="number" id="length" placeholder="255" min="1" />
                <div class="info-text">Character length for VARCHAR/CHAR types</div>
            </div>

            <div class="form-group" id="precisionGroup" style="display: none;">
                <label>Precision</label>
                <input type="number" id="precision" placeholder="10" min="1" />
                <div class="info-text">Total number of digits</div>
            </div>

            <div class="form-group" id="scaleGroup" style="display: none;">
                <label>Scale</label>
                <input type="number" id="scale" placeholder="2" min="0" />
                <div class="info-text">Number of digits after decimal point</div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="nullable" checked />
                <label for="nullable" style="margin: 0;">Allow NULL</label>
            </div>

            <div class="form-group">
                <label>Default Value</label>
                <input type="text" id="defaultValue" placeholder="NULL" />
                <div class="info-text">Default value expression (e.g., 'default_text', 0, NOW(), NULL)</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('constraintsSection')">
                <span class="toggle-icon" id="constraintsIcon">▶</span>
                Constraints
            </div>
            <div class="collapsible-content" id="constraintsSection">
                <div class="checkbox-group">
                    <input type="checkbox" id="isPrimaryKey" />
                    <label for="isPrimaryKey" style="margin: 0;">Primary Key</label>
                </div>
                <div class="info-text">Make this column the primary key</div>

                <div class="checkbox-group" style="margin-top: 12px;">
                    <input type="checkbox" id="isUnique" />
                    <label for="isUnique" style="margin: 0;">Unique</label>
                </div>
                <div class="info-text">Ensure all values in this column are unique</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <div class="sql-preview" id="sqlPreview">-- Fill in the column details to see the SQL preview</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Add Column</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        // Show/hide length, precision, scale fields based on data type
        document.getElementById('dataType').addEventListener('change', function() {
            const dataType = this.value.toUpperCase();
            const lengthGroup = document.getElementById('lengthGroup');
            const precisionGroup = document.getElementById('precisionGroup');
            const scaleGroup = document.getElementById('scaleGroup');

            lengthGroup.style.display = 'none';
            precisionGroup.style.display = 'none';
            scaleGroup.style.display = 'none';

            if (['VARCHAR', 'CHAR', 'CHARACTER'].includes(dataType)) {
                lengthGroup.style.display = 'block';
            } else if (['NUMERIC', 'DECIMAL'].includes(dataType)) {
                precisionGroup.style.display = 'block';
                scaleGroup.style.display = 'block';
            }

            updatePreview();
        });

        // Primary key implies NOT NULL
        document.getElementById('isPrimaryKey').addEventListener('change', function() {
            if (this.checked) {
                document.getElementById('nullable').checked = false;
            }
            updatePreview();
        });

        function getColumnDefinition() {
            const dataType = document.getElementById('dataType').value;
            const columnDef = {
                name: document.getElementById('columnName').value.trim(),
                dataType: dataType,
                nullable: document.getElementById('nullable').checked,
                isPrimaryKey: document.getElementById('isPrimaryKey').checked,
                isUnique: document.getElementById('isUnique').checked
            };

            const lengthVal = document.getElementById('length').value;
            if (lengthVal) columnDef.length = parseInt(lengthVal);

            const precisionVal = document.getElementById('precision').value;
            if (precisionVal) columnDef.precision = parseInt(precisionVal);

            const scaleVal = document.getElementById('scale').value;
            if (scaleVal) columnDef.scale = parseInt(scaleVal);

            const defaultVal = document.getElementById('defaultValue').value.trim();
            if (defaultVal) columnDef.defaultValue = defaultVal;

            return columnDef;
        }

        function updatePreview() {
            const columnDef = getColumnDefinition();
            vscode.postMessage({
                command: 'previewSql',
                columnDef: columnDef
            });
        }

        // Auto-update preview on input changes
        ['columnName', 'dataType', 'length', 'precision', 'scale', 'nullable', 'defaultValue', 'isPrimaryKey', 'isUnique'].forEach(id => {
            const element = document.getElementById(id);
            element.addEventListener('input', updatePreview);
            element.addEventListener('change', updatePreview);
        });

        document.getElementById('createBtn').addEventListener('click', () => {
            const columnDef = getColumnDefinition();
            
            if (!columnDef.name) {
                showError('Column name is required');
                return;
            }

            vscode.postMessage({
                command: 'createColumn',
                columnDef: columnDef
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    document.getElementById('sqlPreview').textContent = message.sql;
                    break;
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            document.getElementById('errorContainer').innerHTML = '';
        }

        // Initialize preview
        updatePreview();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for edit column panel
     */
    private static getEditColumnHtml(schema: string, tableName: string, columnName: string, currentColumn: any): string {
        const currentNullable = currentColumn.is_nullable === 'YES';
        const currentDefault = currentColumn.column_default || '';
        const currentLength = currentColumn.character_maximum_length || '';
        const currentPrecision = currentColumn.numeric_precision || '';
        const currentScale = currentColumn.numeric_scale !== null && currentColumn.numeric_scale !== undefined ? currentColumn.numeric_scale : '';
        const dataType = currentColumn.data_type.toUpperCase();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Column</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Edit Column</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Table</label>
                <input type="text" value="${schema}.${tableName}" readonly />
            </div>

            <div class="form-group">
                <label>Column Name <span class="required">*</span></label>
                <input type="text" id="columnName" value="${columnName}" />
                <div class="info-text">Changing the name will rename the column</div>
            </div>

            <div class="form-group">
                <label>Data Type <span class="required">*</span></label>
                <select id="dataType">
                    <optgroup label="Numeric Types">
                        <option value="INTEGER">INTEGER</option>
                        <option value="BIGINT">BIGINT</option>
                        <option value="SMALLINT">SMALLINT</option>
                        <option value="SERIAL">SERIAL</option>
                        <option value="BIGSERIAL">BIGSERIAL</option>
                        <option value="NUMERIC">NUMERIC</option>
                        <option value="DECIMAL">DECIMAL</option>
                        <option value="REAL">REAL</option>
                        <option value="DOUBLE PRECISION">DOUBLE PRECISION</option>
                    </optgroup>
                    <optgroup label="Text Types">
                        <option value="VARCHAR">VARCHAR</option>
                        <option value="CHAR">CHAR</option>
                        <option value="TEXT">TEXT</option>
                    </optgroup>
                    <optgroup label="Date/Time Types">
                        <option value="DATE">DATE</option>
                        <option value="TIME">TIME</option>
                        <option value="TIMESTAMP">TIMESTAMP</option>
                        <option value="TIMESTAMPTZ">TIMESTAMPTZ</option>
                    </optgroup>
                    <optgroup label="Other Types">
                        <option value="BOOLEAN">BOOLEAN</option>
                        <option value="UUID">UUID</option>
                        <option value="JSON">JSON</option>
                        <option value="JSONB">JSONB</option>
                        <option value="BYTEA">BYTEA</option>
                    </optgroup>
                </select>
                <div class="info-text">Warning: Changing data type may require data migration</div>
            </div>

            <div class="form-group" id="lengthGroup" style="display: none;">
                <label>Length</label>
                <input type="number" id="length" placeholder="255" min="1" value="${currentLength}" />
                <div class="info-text">Character length for VARCHAR/CHAR types</div>
            </div>

            <div class="form-group" id="precisionGroup" style="display: none;">
                <label>Precision</label>
                <input type="number" id="precision" placeholder="10" min="1" value="${currentPrecision}" />
                <div class="info-text">Total number of digits</div>
            </div>

            <div class="form-group" id="scaleGroup" style="display: none;">
                <label>Scale</label>
                <input type="number" id="scale" placeholder="2" min="0" value="${currentScale}" />
                <div class="info-text">Number of digits after decimal point</div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="nullable" ${currentNullable ? 'checked' : ''} />
                <label for="nullable" style="margin: 0;">Allow NULL</label>
            </div>

            <div class="form-group">
                <label>Default Value</label>
                <input type="text" id="defaultValue" placeholder="NULL" value="${currentDefault}" />
                <div class="info-text">Default value expression (e.g., 'default_text', 0, NOW(), NULL)</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <div class="sql-preview" id="sqlPreview">-- SQL will be generated automatically as you make changes</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="editBtn">Apply Changes</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const originalColumnName = '${columnName}';

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        // Set initial data type selection
        document.getElementById('dataType').value = '${dataType}';
        
        // Initialize visibility of type-specific fields
        updateTypeFields('${dataType}');

        function updateTypeFields(dataType) {
            const lengthGroup = document.getElementById('lengthGroup');
            const precisionGroup = document.getElementById('precisionGroup');
            const scaleGroup = document.getElementById('scaleGroup');

            lengthGroup.style.display = 'none';
            precisionGroup.style.display = 'none';
            scaleGroup.style.display = 'none';

            if (['VARCHAR', 'CHAR', 'CHARACTER'].includes(dataType)) {
                lengthGroup.style.display = 'block';
            } else if (['NUMERIC', 'DECIMAL'].includes(dataType)) {
                precisionGroup.style.display = 'block';
                scaleGroup.style.display = 'block';
            }
        }

        // Show/hide length, precision, scale fields based on data type
        document.getElementById('dataType').addEventListener('change', function() {
            updateTypeFields(this.value.toUpperCase());
            updatePreview();
        });

        function getColumnDefinition() {
            const dataType = document.getElementById('dataType').value;
            const columnDef = {
                name: document.getElementById('columnName').value.trim(),
                dataType: dataType,
                nullable: document.getElementById('nullable').checked
            };

            const lengthVal = document.getElementById('length').value;
            if (lengthVal) columnDef.length = parseInt(lengthVal);

            const precisionVal = document.getElementById('precision').value;
            if (precisionVal) columnDef.precision = parseInt(precisionVal);

            const scaleVal = document.getElementById('scale').value;
            if (scaleVal) columnDef.scale = parseInt(scaleVal);

            const defaultVal = document.getElementById('defaultValue').value.trim();
            if (defaultVal) columnDef.defaultValue = defaultVal;

            return columnDef;
        }

        function updatePreview() {
            const columnDef = getColumnDefinition();
            vscode.postMessage({
                command: 'previewSql',
                columnDef: columnDef
            });
        }

        // Auto-update preview on input changes
        ['columnName', 'dataType', 'length', 'precision', 'scale', 'nullable', 'defaultValue'].forEach(id => {
            const element = document.getElementById(id);
            element.addEventListener('input', updatePreview);
            element.addEventListener('change', updatePreview);
        });

        document.getElementById('editBtn').addEventListener('click', () => {
            const columnDef = getColumnDefinition();
            
            if (!columnDef.name) {
                showError('Column name is required');
                return;
            }

            vscode.postMessage({
                command: 'editColumn',
                columnDef: columnDef
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    document.getElementById('sqlPreview').textContent = message.sql;
                    break;
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            document.getElementById('errorContainer').innerHTML = '';
        }

        // Initialize preview
        updatePreview();
    </script>
</body>
</html>`;
    }
}

