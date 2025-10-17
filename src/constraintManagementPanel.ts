import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { SchemaService } from './services/schema.service';
import { getStyles } from './templates/styles';

export interface ConstraintDefinition {
    constraintName: string;
    tableName: string;
    schema: string;
    constraintType: 'check' | 'unique' | 'exclusion' | 'foreignkey';
    columns?: string[];
    checkExpression?: string;
    exclusionMethod?: string;
    exclusionElements?: Array<{element: string; operator: string}>;
    foreignKeyReferencedTable?: string;
    foreignKeyReferencedSchema?: string;
    foreignKeyReferencedColumns?: string[];
    foreignKeyOnUpdate?: string;
    foreignKeyOnDelete?: string;
    foreignKeyMatch?: string;
    deferrable?: boolean;
    deferred?: boolean;
}

export class ConstraintManagementPanel {
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
     * Create a new constraint on a table
     */
    public static async createConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `create_constraint_${database || 'default'}.${schema}.${tableName}`;
        
        if (ConstraintManagementPanel.currentPanels.has(key)) {
            ConstraintManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createConstraint',
            `Create Constraint on ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ConstraintManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ConstraintManagementPanel.currentPanels.delete(key);
        });

        try {
            const schemaService = new SchemaService(stateService, context);
            const columns = await schemaService.getColumns(database || 'postgres', schema, tableName);
            
            panel.webview.html = ConstraintManagementPanel.getCreateConstraintHtml(
                schema,
                tableName,
                columns.map(col => col.name)
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createConstraint':
                        await ConstraintManagementPanel.executeCreateConstraint(
                            context,
                            stateService,
                            message.constraintDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = ConstraintManagementPanel.generateCreateConstraintSql(message.constraintDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load table columns: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop a constraint
     */
    public static async dropConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        constraintName: string,
        cascade: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const cascadeStr = cascade ? ' CASCADE' : '';
            const sql = `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT "${constraintName}"${cascadeStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to drop constraint: ${errorMessage}`);
        }
    }

    /**
     * Edit an existing constraint
     */
    public static async editConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        constraintName: string,
        database?: string
    ): Promise<void> {
        const key = `edit_constraint_${database || 'default'}.${schema}.${tableName}.${constraintName}`;
        
        if (ConstraintManagementPanel.currentPanels.has(key)) {
            ConstraintManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'editConstraint',
            `Edit Constraint: ${constraintName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ConstraintManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ConstraintManagementPanel.currentPanels.delete(key);
        });

        try {
            // Fetch constraint details
            const sqlService = new SqlQueryService(stateService, context);
            const result = await sqlService.executeQuery(`
                SELECT 
                    con.conname as name,
                    con.contype as constraint_type,
                    pg_get_constraintdef(con.oid) as definition,
                    con.condeferrable as is_deferrable,
                    con.condeferred as is_deferred,
                    con.conkey as column_attrnums
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE rel.relname = $1
                    AND nsp.nspname = $2
                    AND con.conname = $3
            `, [tableName, schema, constraintName], database);

            if (result.rows.length === 0) {
                vscode.window.showErrorMessage(`Constraint "${constraintName}" not found`);
                panel.dispose();
                return;
            }

            const constraintInfo = result.rows[0];
            
            // Get table columns
            const schemaService = new SchemaService(stateService, context);
            const columns = await schemaService.getColumns(database || 'postgres', schema, tableName);
            
            panel.webview.html = ConstraintManagementPanel.getEditConstraintHtml(
                schema,
                tableName,
                constraintName,
                constraintInfo,
                columns.map(col => col.name)
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'editConstraint':
                        await ConstraintManagementPanel.executeEditConstraint(
                            context,
                            stateService,
                            message.constraintDef,
                            constraintName,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = ConstraintManagementPanel.generateEditConstraintSql(
                            message.constraintDef,
                            constraintName
                        );
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load constraint: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Validate constraint (enable/disable validation)
     */
    public static async validateConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        constraintName: string,
        validate: boolean,
        database?: string
    ): Promise<void> {
        try {
            const validateStr = validate ? 'VALIDATE' : 'NOT VALID';
            const sql = `ALTER TABLE "${schema}"."${tableName}" ${validate ? 'VALIDATE' : 'ALTER'} CONSTRAINT "${constraintName}" ${validateStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintName}" ${validate ? 'validated' : 'marked as not valid'} successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to validate constraint: ${errorMessage}`);
        }
    }

    /**
     * Execute create constraint
     */
    private static async executeCreateConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        constraintDef: ConstraintDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = ConstraintManagementPanel.generateCreateConstraintSql(constraintDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintDef.constraintName}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
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
     * Execute edit constraint
     */
    private static async executeEditConstraint(
        context: vscode.ExtensionContext,
        stateService: StateService,
        constraintDef: ConstraintDefinition,
        oldConstraintName: string,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = ConstraintManagementPanel.generateEditConstraintSql(constraintDef, oldConstraintName);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Constraint "${constraintDef.constraintName}" updated successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
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
     * Generate CREATE CONSTRAINT SQL
     */
    private static generateCreateConstraintSql(constraintDef: ConstraintDefinition): string {
        const {
            constraintName,
            tableName,
            schema,
            constraintType,
            columns,
            checkExpression,
            exclusionMethod,
            exclusionElements,
            foreignKeyReferencedTable,
            foreignKeyReferencedSchema,
            foreignKeyReferencedColumns,
            foreignKeyOnUpdate,
            foreignKeyOnDelete,
            foreignKeyMatch,
            deferrable,
            deferred
        } = constraintDef;

        let sql = `ALTER TABLE "${schema}"."${tableName}" ADD CONSTRAINT "${constraintName}"`;

        switch (constraintType) {
            case 'check':
                sql += ` CHECK (${checkExpression})`;
                break;
            
            case 'unique':
                sql += ` UNIQUE (${columns!.map(col => `"${col}"`).join(', ')})`;
                break;
            
            case 'exclusion':
                sql += ` EXCLUDE USING ${exclusionMethod} (`;
                sql += exclusionElements!.map(el => `${el.element} WITH ${el.operator}`).join(', ');
                sql += ')';
                break;
            
            case 'foreignkey':
                sql += ` FOREIGN KEY (${columns!.map(col => `"${col}"`).join(', ')})`;
                sql += ` REFERENCES "${foreignKeyReferencedSchema}"."${foreignKeyReferencedTable}" (${foreignKeyReferencedColumns!.map(col => `"${col}"`).join(', ')})`;
                if (foreignKeyMatch && foreignKeyMatch !== 'SIMPLE') {
                    sql += ` MATCH ${foreignKeyMatch}`;
                }
                if (foreignKeyOnUpdate && foreignKeyOnUpdate !== 'NO ACTION') {
                    sql += ` ON UPDATE ${foreignKeyOnUpdate}`;
                }
                if (foreignKeyOnDelete && foreignKeyOnDelete !== 'NO ACTION') {
                    sql += ` ON DELETE ${foreignKeyOnDelete}`;
                }
                break;
        }

        if (deferrable) {
            sql += ' DEFERRABLE';
            if (deferred) {
                sql += ' INITIALLY DEFERRED';
            } else {
                sql += ' INITIALLY IMMEDIATE';
            }
        } else {
            sql += ' NOT DEFERRABLE';
        }

        sql += ';';
        return sql;
    }

    /**
     * Generate EDIT CONSTRAINT SQL (DROP + CREATE)
     */
    private static generateEditConstraintSql(constraintDef: ConstraintDefinition, oldConstraintName: string): string {
        const { tableName, schema } = constraintDef;
        
        // Drop the old constraint
        let sql = `ALTER TABLE "${schema}"."${tableName}" DROP CONSTRAINT "${oldConstraintName}";\n`;
        
        // Add the new constraint
        sql += ConstraintManagementPanel.generateCreateConstraintSql(constraintDef);
        
        return sql;
    }

    /**
     * Get HTML for create constraint panel
     */
    private static getCreateConstraintHtml(
        schema: string,
        tableName: string,
        columns: string[]
    ): string {
        const columnsJson = JSON.stringify(columns);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Constraint</title>
    ${getStyles()}
    <style>
        .column-selector {
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            max-height: 150px;
            overflow-y: auto;
            background-color: var(--vscode-input-background);
        }
        .column-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px;
            cursor: pointer;
        }
        .column-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .exclusion-element-row {
            display: grid;
            grid-template-columns: 1fr 120px 40px;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }
        .btn-remove {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-remove:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create Constraint on ${schema}.${tableName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Constraint Name <span class="required">*</span></label>
                <input type="text" id="constraintName" placeholder="chk_tablename_condition" />
                <div class="info-text">Naming conventions: chk_ for CHECK, uq_ for UNIQUE, ex_ for EXCLUSION, fk_ for FOREIGN KEY</div>
            </div>

            <div class="form-group">
                <label>Constraint Type <span class="required">*</span></label>
                <select id="constraintType">
                    <option value="check">CHECK - Validate expression</option>
                    <option value="unique">UNIQUE - Ensure column uniqueness</option>
                    <option value="exclusion">EXCLUSION - Prevent overlapping values</option>
                    <option value="foreignkey">FOREIGN KEY - Reference another table</option>
                </select>
                <div class="info-text">CHECK validates data, UNIQUE prevents duplicates, EXCLUSION prevents overlaps, FOREIGN KEY enforces relationships</div>
            </div>
        </div>

        <div class="section-box" id="checkSection" style="display: none;">
            <label>CHECK Expression <span class="required">*</span></label>
            <div class="form-group">
                <textarea id="checkExpression" rows="4" placeholder="e.g., age >= 18 AND age <= 120"></textarea>
                <div class="info-text">Boolean expression that must evaluate to true for all rows</div>
            </div>
        </div>

        <div class="section-box" id="uniqueSection" style="display: none;">
            <label>Select Columns <span class="required">*</span></label>
            <div class="info-text" style="margin-bottom: 8px;">Select one or more columns that must be unique together</div>
            <div class="column-selector" id="uniqueColumnSelector"></div>
        </div>

        <div class="section-box" id="exclusionSection" style="display: none;">
            <div class="form-group">
                <label>Index Method <span class="required">*</span></label>
                <select id="exclusionMethod">
                    <option value="gist">GiST (Most Common)</option>
                    <option value="spgist">SP-GiST</option>
                    <option value="btree">B-tree</option>
                    <option value="hash">Hash</option>
                </select>
                <div class="info-text">GiST supports most data types and operators</div>
            </div>
            
            <label>Exclusion Elements</label>
            <div id="exclusionElementsContainer"></div>
            <button type="button" class="btn btn-secondary" id="addExclusionElement">Add Element</button>
        </div>

        <div class="section-box" id="foreignKeySection" style="display: none;">
            <div class="form-group">
                <label>Local Columns <span class="required">*</span></label>
                <div class="info-text" style="margin-bottom: 8px;">Select columns from this table that reference another table</div>
                <div class="column-selector" id="fkColumnSelector"></div>
            </div>

            <div class="form-group">
                <label>Referenced Schema <span class="required">*</span></label>
                <input type="text" id="fkReferencedSchema" placeholder="public" value="${schema}" />
                <div class="info-text">Schema containing the referenced table</div>
            </div>

            <div class="form-group">
                <label>Referenced Table <span class="required">*</span></label>
                <input type="text" id="fkReferencedTable" placeholder="referenced_table" />
                <div class="info-text">Table that is being referenced</div>
            </div>

            <div class="form-group">
                <label>Referenced Columns <span class="required">*</span></label>
                <input type="text" id="fkReferencedColumns" placeholder="id, code" />
                <div class="info-text">Comma-separated list of columns in the referenced table (must match the number and types of local columns)</div>
            </div>

            <div class="form-group">
                <label>ON DELETE</label>
                <select id="fkOnDelete">
                    <option value="NO ACTION">NO ACTION (Default)</option>
                    <option value="RESTRICT">RESTRICT</option>
                    <option value="CASCADE">CASCADE</option>
                    <option value="SET NULL">SET NULL</option>
                    <option value="SET DEFAULT">SET DEFAULT</option>
                </select>
                <div class="info-text">Action to take when referenced row is deleted</div>
            </div>

            <div class="form-group">
                <label>ON UPDATE</label>
                <select id="fkOnUpdate">
                    <option value="NO ACTION">NO ACTION (Default)</option>
                    <option value="RESTRICT">RESTRICT</option>
                    <option value="CASCADE">CASCADE</option>
                    <option value="SET NULL">SET NULL</option>
                    <option value="SET DEFAULT">SET DEFAULT</option>
                </select>
                <div class="info-text">Action to take when referenced row is updated</div>
            </div>

            <div class="form-group">
                <label>MATCH Type</label>
                <select id="fkMatch">
                    <option value="SIMPLE">SIMPLE (Default)</option>
                    <option value="FULL">FULL</option>
                    <option value="PARTIAL">PARTIAL</option>
                </select>
                <div class="info-text">How NULL values in the foreign key are handled</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('optionsSection')">
                <span class="toggle-icon" id="optionsIcon">▶</span>
                Advanced Options
            </div>
            <div class="collapsible-content" id="optionsSection">
                <div class="checkbox-group">
                    <input type="checkbox" id="deferrable" />
                    <label for="deferrable" style="margin: 0;">Deferrable</label>
                </div>
                <div class="info-text">Can constraint checking be deferred until end of transaction?</div>

                <div class="checkbox-group" style="margin-top: 16px;">
                    <input type="checkbox" id="deferred" disabled />
                    <label for="deferred" style="margin: 0;">Initially Deferred</label>
                </div>
                <div class="info-text">If deferrable, should checking be deferred by default?</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <div class="sql-preview" id="sqlPreview">-- Fill in required fields to generate SQL preview</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create Constraint</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const columns = ${columnsJson};
        let selectedUniqueColumns = [];
        let selectedFkColumns = [];

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        const constraintNameInput = document.getElementById('constraintName');
        const constraintTypeSelect = document.getElementById('constraintType');
        const checkSection = document.getElementById('checkSection');
        const uniqueSection = document.getElementById('uniqueSection');
        const exclusionSection = document.getElementById('exclusionSection');
        const foreignKeySection = document.getElementById('foreignKeySection');
        const checkExpressionInput = document.getElementById('checkExpression');
        const uniqueColumnSelector = document.getElementById('uniqueColumnSelector');
        const exclusionMethodSelect = document.getElementById('exclusionMethod');
        const exclusionElementsContainer = document.getElementById('exclusionElementsContainer');
        const addExclusionElementBtn = document.getElementById('addExclusionElement');
        const fkColumnSelector = document.getElementById('fkColumnSelector');
        const fkReferencedSchema = document.getElementById('fkReferencedSchema');
        const fkReferencedTable = document.getElementById('fkReferencedTable');
        const fkReferencedColumns = document.getElementById('fkReferencedColumns');
        const fkOnDelete = document.getElementById('fkOnDelete');
        const fkOnUpdate = document.getElementById('fkOnUpdate');
        const fkMatch = document.getElementById('fkMatch');
        const deferrableCheckbox = document.getElementById('deferrable');
        const deferredCheckbox = document.getElementById('deferred');
        const createBtn = document.getElementById('createBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        // Render unique column checkboxes
        columns.forEach(col => {
            const div = document.createElement('div');
            div.className = 'column-item';
            div.innerHTML = \`
                <input type="checkbox" id="unique_col_\${col}" value="\${col}" />
                <label for="unique_col_\${col}" style="cursor: pointer; margin: 0;">\${col}</label>
            \`;
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = div.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            div.querySelector('input').addEventListener('change', () => {
                selectedUniqueColumns = Array.from(uniqueColumnSelector.querySelectorAll('input:checked')).map(cb => cb.value);
                updatePreview();
            });
            uniqueColumnSelector.appendChild(div);
        });

        // Render foreign key column checkboxes
        columns.forEach(col => {
            const div = document.createElement('div');
            div.className = 'column-item';
            div.innerHTML = \`
                <input type="checkbox" id="fk_col_\${col}" value="\${col}" />
                <label for="fk_col_\${col}" style="cursor: pointer; margin: 0;">\${col}</label>
            \`;
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = div.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            div.querySelector('input').addEventListener('change', () => {
                selectedFkColumns = Array.from(fkColumnSelector.querySelectorAll('input:checked')).map(cb => cb.value);
                updatePreview();
            });
            fkColumnSelector.appendChild(div);
        });

        // Show/hide sections based on constraint type
        constraintTypeSelect.addEventListener('change', () => {
            checkSection.style.display = 'none';
            uniqueSection.style.display = 'none';
            exclusionSection.style.display = 'none';
            foreignKeySection.style.display = 'none';
            
            const type = constraintTypeSelect.value;
            if (type === 'check') {
                checkSection.style.display = 'block';
            } else if (type === 'unique') {
                uniqueSection.style.display = 'block';
            } else if (type === 'exclusion') {
                exclusionSection.style.display = 'block';
            } else if (type === 'foreignkey') {
                foreignKeySection.style.display = 'block';
            }
            updatePreview();
        });

        // Deferrable checkbox controls deferred checkbox
        deferrableCheckbox.addEventListener('change', () => {
            deferredCheckbox.disabled = !deferrableCheckbox.checked;
            if (!deferrableCheckbox.checked) {
                deferredCheckbox.checked = false;
            }
            updatePreview();
        });

        // Add exclusion element
        addExclusionElementBtn.addEventListener('click', () => {
            const row = document.createElement('div');
            row.className = 'exclusion-element-row';
            row.innerHTML = \`
                <input type="text" placeholder="column or expression" class="exclusion-element" />
                <select class="exclusion-operator">
                    <option value="&&">&&</option>
                    <option value="=">=</option>
                    <option value="<>"><></option>
                    <option value="<"><</option>
                    <option value="<="><=</option>
                    <option value=">">></option>
                    <option value=">=">>=</option>
                </select>
                <button type="button" class="btn-remove">×</button>
            \`;
            row.querySelector('.btn-remove').addEventListener('click', () => {
                row.remove();
                updatePreview();
            });
            row.querySelector('.exclusion-element').addEventListener('input', updatePreview);
            row.querySelector('.exclusion-operator').addEventListener('change', updatePreview);
            exclusionElementsContainer.appendChild(row);
            updatePreview();
        });

        function getConstraintDefinition() {
            const type = constraintTypeSelect.value;
            const def = {
                constraintName: constraintNameInput.value.trim(),
                tableName: '${tableName}',
                schema: '${schema}',
                constraintType: type,
                deferrable: deferrableCheckbox.checked,
                deferred: deferredCheckbox.checked
            };

            if (type === 'check') {
                def.checkExpression = checkExpressionInput.value.trim();
            } else if (type === 'unique') {
                def.columns = selectedUniqueColumns;
            } else if (type === 'exclusion') {
                def.exclusionMethod = exclusionMethodSelect.value;
                def.exclusionElements = Array.from(exclusionElementsContainer.querySelectorAll('.exclusion-element-row')).map(row => ({
                    element: row.querySelector('.exclusion-element').value.trim(),
                    operator: row.querySelector('.exclusion-operator').value
                }));
            } else if (type === 'foreignkey') {
                def.columns = selectedFkColumns;
                def.foreignKeyReferencedSchema = fkReferencedSchema.value.trim();
                def.foreignKeyReferencedTable = fkReferencedTable.value.trim();
                def.foreignKeyReferencedColumns = fkReferencedColumns.value.split(',').map(c => c.trim()).filter(c => c);
                def.foreignKeyOnDelete = fkOnDelete.value;
                def.foreignKeyOnUpdate = fkOnUpdate.value;
                def.foreignKeyMatch = fkMatch.value;
            }

            return def;
        }

        function validateConstraint(showErrors = true) {
            if (showErrors) {
                clearError();
            }

            if (!constraintNameInput.value.trim()) {
                if (showErrors) showError('Constraint name is required');
                return false;
            }

            if (!/^[a-z_][a-z0-9_]*$/i.test(constraintNameInput.value.trim())) {
                if (showErrors) showError('Constraint name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }

            const type = constraintTypeSelect.value;
            if (type === 'check' && !checkExpressionInput.value.trim()) {
                if (showErrors) showError('CHECK expression is required');
                return false;
            }

            if (type === 'unique' && selectedUniqueColumns.length === 0) {
                if (showErrors) showError('At least one column must be selected for UNIQUE constraint');
                return false;
            }

            if (type === 'exclusion') {
                const elements = Array.from(exclusionElementsContainer.querySelectorAll('.exclusion-element-row'));
                if (elements.length === 0) {
                    if (showErrors) showError('At least one exclusion element is required');
                    return false;
                }
                for (const row of elements) {
                    if (!row.querySelector('.exclusion-element').value.trim()) {
                        if (showErrors) showError('All exclusion elements must have a value');
                        return false;
                    }
                }
            }

            if (type === 'foreignkey') {
                if (selectedFkColumns.length === 0) {
                    if (showErrors) showError('At least one local column must be selected for FOREIGN KEY constraint');
                    return false;
                }
                if (!fkReferencedSchema.value.trim()) {
                    if (showErrors) showError('Referenced schema is required');
                    return false;
                }
                if (!fkReferencedTable.value.trim()) {
                    if (showErrors) showError('Referenced table is required');
                    return false;
                }
                const refCols = fkReferencedColumns.value.split(',').map(c => c.trim()).filter(c => c);
                if (refCols.length === 0) {
                    if (showErrors) showError('Referenced columns are required');
                    return false;
                }
                if (refCols.length !== selectedFkColumns.length) {
                    if (showErrors) showError('Number of referenced columns must match the number of local columns');
                    return false;
                }
            }

            return true;
        }

        function updatePreview() {
            if (!validateConstraint(false)) {
                document.getElementById('sqlPreview').textContent = '-- Fill in required fields to generate SQL preview';
                return;
            }
            vscode.postMessage({
                command: 'previewSql',
                constraintDef: getConstraintDefinition()
            });
        }

        // Auto-update preview
        constraintNameInput.addEventListener('input', updatePreview);
        checkExpressionInput.addEventListener('input', updatePreview);
        exclusionMethodSelect.addEventListener('change', updatePreview);
        fkReferencedSchema.addEventListener('input', updatePreview);
        fkReferencedTable.addEventListener('input', updatePreview);
        fkReferencedColumns.addEventListener('input', updatePreview);
        fkOnDelete.addEventListener('change', updatePreview);
        fkOnUpdate.addEventListener('change', updatePreview);
        fkMatch.addEventListener('change', updatePreview);
        deferredCheckbox.addEventListener('change', updatePreview);

        createBtn.addEventListener('click', () => {
            if (!validateConstraint(true)) return;
            vscode.postMessage({
                command: 'createConstraint',
                constraintDef: getConstraintDefinition()
            });
        });

        cancelBtn.addEventListener('click', () => {
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
            errorContainer.innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }

        // Initialize - show CHECK section by default
        checkSection.style.display = 'block';
        updatePreview();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for edit constraint panel
     */
    private static getEditConstraintHtml(
        schema: string,
        tableName: string,
        constraintName: string,
        constraintInfo: any,
        columns: string[]
    ): string {
        const columnsJson = JSON.stringify(columns);
        const constraintType = constraintInfo.constraint_type;
        const definition = constraintInfo.definition;
        const isDeferrable = constraintInfo.is_deferrable;
        const isDeferred = constraintInfo.is_deferred;
        
        // Parse constraint definition to extract values
        let initialConstraintType = '';
        let initialCheckExpression = '';
        let initialColumns: string[] = [];
        
        if (constraintType === 'c') {
            initialConstraintType = 'check';
            // Extract CHECK expression: CHECK (expression)
            const checkMatch = definition.match(/CHECK\s*\((.*)\)/is);
            if (checkMatch) {
                initialCheckExpression = checkMatch[1].trim();
            }
        } else if (constraintType === 'u') {
            initialConstraintType = 'unique';
            // Extract column names: UNIQUE (col1, col2, ...)
            const uniqueMatch = definition.match(/UNIQUE\s*\((.*?)\)/i);
            if (uniqueMatch) {
                initialColumns = uniqueMatch[1].split(',').map(col => col.trim().replace(/"/g, ''));
            }
        } else if (constraintType === 'x') {
            initialConstraintType = 'exclusion';
        }
        
        const initialColumnsJson = JSON.stringify(initialColumns);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Constraint</title>
    ${getStyles()}
    <style>
        .column-selector {
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            max-height: 150px;
            overflow-y: auto;
            background-color: var(--vscode-input-background);
        }
        .column-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px;
            cursor: pointer;
        }
        .column-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .exclusion-element-row {
            display: grid;
            grid-template-columns: 1fr 120px 40px;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }
        .btn-remove {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-remove:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit Constraint</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Constraint Name <span class="required">*</span></label>
                <input type="text" id="constraintName" value="${constraintName}" />
                <div class="info-text">Rename constraint by changing the name</div>
            </div>

            <div class="form-group">
                <label>Constraint Type (Read-only)</label>
                <input type="text" id="constraintTypeDisplay" value="${initialConstraintType === 'check' ? 'CHECK' : initialConstraintType === 'unique' ? 'UNIQUE' : 'EXCLUSION'}" disabled />
                <input type="hidden" id="constraintType" value="${initialConstraintType}" />
                <div class="info-text">Constraint type cannot be changed. Drop and create a new constraint to change type.</div>
            </div>
        </div>

        <div class="section-box" id="checkSection" style="display: none;">
            <label>CHECK Expression <span class="required">*</span></label>
            <div class="form-group">
                <textarea id="checkExpression" rows="4" placeholder="e.g., age >= 18 AND age <= 120">${initialCheckExpression}</textarea>
                <div class="info-text">Boolean expression that must evaluate to true for all rows</div>
            </div>
        </div>

        <div class="section-box" id="uniqueSection" style="display: none;">
            <label>Select Columns <span class="required">*</span></label>
            <div class="info-text" style="margin-bottom: 8px;">Select one or more columns that must be unique together</div>
            <div class="column-selector" id="uniqueColumnSelector"></div>
        </div>

        <div class="section-box" id="exclusionSection" style="display: none;">
            <div class="info-text">EXCLUSION constraints are complex and editing is not fully supported. Please drop and recreate this constraint if you need to modify it.</div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('optionsSection')">
                <span class="toggle-icon" id="optionsIcon">▶</span>
                Advanced Options
            </div>
            <div class="collapsible-content" id="optionsSection">
                <div class="checkbox-group">
                    <input type="checkbox" id="deferrable" ${isDeferrable ? 'checked' : ''} />
                    <label for="deferrable" style="margin: 0;">Deferrable</label>
                </div>
                <div class="info-text">Can constraint checking be deferred until end of transaction?</div>

                <div class="checkbox-group" style="margin-top: 16px;">
                    <input type="checkbox" id="deferred" ${isDeferred ? 'checked' : ''} ${!isDeferrable ? 'disabled' : ''} />
                    <label for="deferred" style="margin: 0;">Initially Deferred</label>
                </div>
                <div class="info-text">If deferrable, should checking be deferred by default?</div>
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
            <button class="btn" id="saveBtn">Save Changes</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const columns = ${columnsJson};
        const initialColumns = ${initialColumnsJson};
        let selectedUniqueColumns = [...initialColumns];

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        const constraintNameInput = document.getElementById('constraintName');
        const constraintTypeInput = document.getElementById('constraintType');
        const checkSection = document.getElementById('checkSection');
        const uniqueSection = document.getElementById('uniqueSection');
        const exclusionSection = document.getElementById('exclusionSection');
        const checkExpressionInput = document.getElementById('checkExpression');
        const uniqueColumnSelector = document.getElementById('uniqueColumnSelector');
        const deferrableCheckbox = document.getElementById('deferrable');
        const deferredCheckbox = document.getElementById('deferred');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        // Render unique column checkboxes
        columns.forEach(col => {
            const div = document.createElement('div');
            div.className = 'column-item';
            const isChecked = initialColumns.includes(col);
            div.innerHTML = \`
                <input type="checkbox" id="unique_col_\${col}" value="\${col}" \${isChecked ? 'checked' : ''} />
                <label for="unique_col_\${col}" style="cursor: pointer; margin: 0;">\${col}</label>
            \`;
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = div.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            div.querySelector('input').addEventListener('change', () => {
                selectedUniqueColumns = Array.from(uniqueColumnSelector.querySelectorAll('input:checked')).map(cb => cb.value);
                updatePreview();
            });
            uniqueColumnSelector.appendChild(div);
        });

        // Show the correct section based on constraint type
        const type = constraintTypeInput.value;
        if (type === 'check') {
            checkSection.style.display = 'block';
        } else if (type === 'unique') {
            uniqueSection.style.display = 'block';
        } else if (type === 'exclusion') {
            exclusionSection.style.display = 'block';
        }

        // Deferrable checkbox controls deferred checkbox
        deferrableCheckbox.addEventListener('change', () => {
            deferredCheckbox.disabled = !deferrableCheckbox.checked;
            if (!deferrableCheckbox.checked) {
                deferredCheckbox.checked = false;
            }
            updatePreview();
        });

        function getConstraintDefinition() {
            const type = constraintTypeInput.value;
            const def = {
                constraintName: constraintNameInput.value.trim(),
                tableName: '${tableName}',
                schema: '${schema}',
                constraintType: type,
                deferrable: deferrableCheckbox.checked,
                deferred: deferredCheckbox.checked
            };

            if (type === 'check') {
                def.checkExpression = checkExpressionInput.value.trim();
            } else if (type === 'unique') {
                def.columns = selectedUniqueColumns;
            }

            return def;
        }

        function validateConstraint(showErrors = true) {
            if (showErrors) {
                clearError();
            }

            if (!constraintNameInput.value.trim()) {
                if (showErrors) showError('Constraint name is required');
                return false;
            }

            if (!/^[a-z_][a-z0-9_]*$/i.test(constraintNameInput.value.trim())) {
                if (showErrors) showError('Constraint name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }

            const type = constraintTypeInput.value;
            if (type === 'check' && !checkExpressionInput.value.trim()) {
                if (showErrors) showError('CHECK expression is required');
                return false;
            }

            if (type === 'unique' && selectedUniqueColumns.length === 0) {
                if (showErrors) showError('At least one column must be selected for UNIQUE constraint');
                return false;
            }

            if (type === 'exclusion') {
                if (showErrors) showError('EXCLUSION constraint editing is not fully supported');
                return false;
            }

            return true;
        }

        function updatePreview() {
            if (!validateConstraint(false)) {
                document.getElementById('sqlPreview').textContent = '-- Fill in required fields to generate SQL preview';
                return;
            }
            vscode.postMessage({
                command: 'previewSql',
                constraintDef: getConstraintDefinition()
            });
        }

        // Auto-update preview
        constraintNameInput.addEventListener('input', updatePreview);
        checkExpressionInput.addEventListener('input', updatePreview);
        deferredCheckbox.addEventListener('change', updatePreview);

        saveBtn.addEventListener('click', () => {
            if (!validateConstraint(true)) return;
            vscode.postMessage({
                command: 'editConstraint',
                constraintDef: getConstraintDefinition()
            });
        });

        cancelBtn.addEventListener('click', () => {
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
            errorContainer.innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function clearError() {
            errorContainer.innerHTML = '';
        }

        // Initialize preview
        updatePreview();
    </script>
</body>
</html>`;
    }
}

