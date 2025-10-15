import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { getStyles } from './templates/styles';

export interface SequenceDefinition {
    name: string;
    schema: string;
    startValue?: number;
    incrementBy?: number;
    minValue?: number;
    maxValue?: number;
    cache?: number;
    cycle?: boolean;
    ownedBy?: string;
}

export interface SequenceProperties {
    name: string;
    schema: string;
    dataType: string;
    startValue: string;
    minValue: string;
    maxValue: string;
    incrementBy: string;
    cache: string;
    cycle: boolean;
    lastValue: string;
    owner: string;
}

export class SequenceManagementPanel {
    public static currentPanels = new Map<string, vscode.WebviewPanel>();

    /**
     * Create a new sequence
     */
    public static async createSequence(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        database?: string
    ): Promise<void> {
        const key = `create_sequence_${database || 'default'}.${schema}`;
        
        if (SequenceManagementPanel.currentPanels.has(key)) {
            SequenceManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createSequence',
            `Create Sequence: ${schema}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SequenceManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            SequenceManagementPanel.currentPanels.delete(key);
        });

        try {
            panel.webview.html = SequenceManagementPanel.getCreateSequenceHtml(schema);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createSequence':
                        await SequenceManagementPanel.executeCreateSequence(
                            context,
                            stateService,
                            message.seqDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = SequenceManagementPanel.generateCreateSequenceSql(message.seqDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open create sequence panel: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Alter sequence
     */
    public static async alterSequence(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        sequenceName: string,
        database?: string
    ): Promise<void> {
        const key = `alter_${database || 'default'}.${schema}.${sequenceName}`;
        
        if (SequenceManagementPanel.currentPanels.has(key)) {
            SequenceManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'alterSequence',
            `Edit Sequence: ${schema}.${sequenceName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        SequenceManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            SequenceManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get current sequence properties
            const propsResult = await sqlService.executeQuery(`
                SELECT 
                    s.increment,
                    s.minimum_value,
                    s.maximum_value,
                    s.cycle_option,
                    COALESCE(seq.seqcache, 1) as cache
                FROM information_schema.sequences s
                LEFT JOIN pg_class c ON c.relname = s.sequence_name
                LEFT JOIN pg_namespace n ON n.nspname = s.sequence_schema AND n.oid = c.relnamespace
                LEFT JOIN pg_sequence seq ON seq.seqrelid = c.oid
                WHERE s.sequence_schema = $1 AND s.sequence_name = $2
            `, [schema, sequenceName], database);

            if (propsResult.rows.length === 0) {
                vscode.window.showErrorMessage(`Sequence "${schema}.${sequenceName}" not found`);
                panel.dispose();
                return;
            }

            const currentProps = propsResult.rows[0];

            panel.webview.html = SequenceManagementPanel.getAlterSequenceHtml(
                schema,
                sequenceName,
                currentProps
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'alterSequence':
                        await SequenceManagementPanel.executeAlterSequence(
                            context,
                            stateService,
                            schema,
                            sequenceName,
                            message.changes,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = SequenceManagementPanel.generateAlterSequenceSql(
                            schema,
                            sequenceName,
                            message.changes
                        );
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            vscode.window.showErrorMessage(`Failed to open edit sequence panel: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop sequence
     */
    public static async dropSequence(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        sequenceName: string,
        cascade: boolean,
        database?: string
    ): Promise<void> {
        try {
            const sql = `DROP SEQUENCE "${schema}"."${sequenceName}"${cascade ? ' CASCADE' : ' RESTRICT'};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Sequence "${schema}.${sequenceName}" dropped successfully!`);
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
            
            vscode.window.showErrorMessage(`Failed to drop sequence: ${errorMessage}`);
            // Note: Don't throw the error - it's already been displayed to the user
        }
    }

    /**
     * Restart sequence
     */
    private static async restartSequence(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        sequenceName: string,
        value?: number,
        database?: string
    ): Promise<void> {
        try {
            const sql = value !== undefined
                ? `ALTER SEQUENCE ${schema}.${sequenceName} RESTART WITH ${value};`
                : `ALTER SEQUENCE ${schema}.${sequenceName} RESTART;`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Sequence "${schema}.${sequenceName}" restarted!`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to restart sequence: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Set next value
     */
    private static async setNextValue(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        sequenceName: string,
        value: number,
        database?: string
    ): Promise<void> {
        try {
            const sql = `SELECT setval('${schema}.${sequenceName}', ${value});`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Sequence "${schema}.${sequenceName}" next value set to ${value}!`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to set sequence value: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Execute create sequence
     */
    private static async executeCreateSequence(
        context: vscode.ExtensionContext,
        stateService: StateService,
        seqDef: SequenceDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = SequenceManagementPanel.generateCreateSequenceSql(seqDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Sequence "${seqDef.schema}.${seqDef.name}" created successfully!`);
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
     * Execute alter sequence
     */
    private static async executeAlterSequence(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        sequenceName: string,
        changes: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = SequenceManagementPanel.generateAlterSequenceSql(schema, sequenceName, changes);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Sequence "${schema}.${sequenceName}" altered successfully!`);
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
     * Generate CREATE SEQUENCE SQL
     */
    private static generateCreateSequenceSql(seqDef: SequenceDefinition): string {
        const {
            name,
            schema,
            startValue,
            incrementBy,
            minValue,
            maxValue,
            cache,
            cycle
        } = seqDef;

        let sql = `CREATE SEQUENCE ${schema}.${name}`;
        
        const options: string[] = [];
        
        if (incrementBy !== undefined) {
            options.push(`INCREMENT BY ${incrementBy}`);
        }
        
        if (minValue !== undefined) {
            options.push(`MINVALUE ${minValue}`);
        } else {
            options.push('NO MINVALUE');
        }
        
        if (maxValue !== undefined) {
            options.push(`MAXVALUE ${maxValue}`);
        } else {
            options.push('NO MAXVALUE');
        }
        
        if (startValue !== undefined) {
            options.push(`START WITH ${startValue}`);
        }
        
        if (cache !== undefined && cache > 1) {
            options.push(`CACHE ${cache}`);
        }
        
        if (cycle) {
            options.push('CYCLE');
        } else {
            options.push('NO CYCLE');
        }
        
        if (options.length > 0) {
            sql += '\n  ' + options.join('\n  ');
        }
        
        sql += ';';
        
        return sql;
    }

    /**
     * Generate ALTER SEQUENCE SQL
     */
    private static generateAlterSequenceSql(
        schema: string,
        sequenceName: string,
        changes: any
    ): string {
        const statements: string[] = [];
        const options: string[] = [];
        
        if (changes.incrementBy !== undefined && changes.incrementBy !== '') {
            options.push(`INCREMENT BY ${changes.incrementBy}`);
        }
        
        if (changes.minValue !== undefined && changes.minValue !== '') {
            if (changes.minValue === 'NO MINVALUE') {
                options.push('NO MINVALUE');
            } else {
                options.push(`MINVALUE ${changes.minValue}`);
            }
        }
        
        if (changes.maxValue !== undefined && changes.maxValue !== '') {
            if (changes.maxValue === 'NO MAXVALUE') {
                options.push('NO MAXVALUE');
            } else {
                options.push(`MAXVALUE ${changes.maxValue}`);
            }
        }
        
        if (changes.cache !== undefined && changes.cache !== '') {
            options.push(`CACHE ${changes.cache}`);
        }
        
        if (changes.cycle !== undefined) {
            options.push(changes.cycle ? 'CYCLE' : 'NO CYCLE');
        }
        
        if (options.length > 0) {
            let sql = `ALTER SEQUENCE ${schema}.${sequenceName}`;
            sql += '\n  ' + options.join('\n  ');
            sql += ';';
            statements.push(sql);
        }
        
        // Handle sequence rename if needed
        if (changes.newSequenceName && changes.newSequenceName !== sequenceName) {
            statements.push(`\nALTER SEQUENCE ${schema}.${sequenceName} RENAME TO ${changes.newSequenceName};`);
        }
        
        return statements.length > 0 ? statements.join('\n') : '-- No changes to apply';
    }

    /**
     * Get HTML for create sequence panel
     */
    private static getCreateSequenceHtml(schema: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Sequence</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Create Sequence in ${schema}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Sequence Name <span class="required">*</span></label>
                <input type="text" id="seqName" placeholder="my_sequence" />
                <div class="info-text">Name must start with a letter and contain only letters, numbers, and underscores</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('optionsSection')">
                <span class="toggle-icon" id="optionsIcon">▶</span>
                Sequence Options
            </div>
            <div class="collapsible-content" id="optionsSection">
                <div class="form-group">
                    <label>Start Value</label>
                    <input type="number" id="startValue" placeholder="1" />
                    <div class="info-text">Initial value of the sequence (defaults to 1)</div>
                </div>

                <div class="form-group">
                    <label>Increment By</label>
                    <input type="number" id="incrementBy" value="1" />
                    <div class="info-text">Value to add to current sequence value (can be negative)</div>
                </div>

                <div class="form-group">
                    <label>Minimum Value</label>
                    <input type="number" id="minValue" placeholder="Leave empty for NO MINVALUE" />
                    <div class="info-text">Minimum value of the sequence (or leave empty)</div>
                </div>

                <div class="form-group">
                    <label>Maximum Value</label>
                    <input type="number" id="maxValue" placeholder="Leave empty for NO MAXVALUE" />
                    <div class="info-text">Maximum value of the sequence (or leave empty)</div>
                </div>

                <div class="form-group">
                    <label>Cache Size</label>
                    <input type="number" id="cache" value="1" min="1" />
                    <div class="info-text">Number of sequence values to pre-allocate (improves performance)</div>
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="cycle" />
                    <label for="cycle" style="margin: 0;">Cycle</label>
                </div>
                <div class="info-text">Allow sequence to wrap around when reaching max/min value</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <div class="sql-preview" id="sqlPreview">-- Fill in the sequence name to see the SQL preview</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create Sequence</button>
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

        function getSequenceDefinition() {
            const minVal = document.getElementById('minValue').value;
            const maxVal = document.getElementById('maxValue').value;
            const startVal = document.getElementById('startValue').value;
            
            return {
                name: document.getElementById('seqName').value.trim(),
                schema: '${schema}',
                startValue: startVal ? parseInt(startVal) : undefined,
                incrementBy: parseInt(document.getElementById('incrementBy').value),
                minValue: minVal ? parseInt(minVal) : undefined,
                maxValue: maxVal ? parseInt(maxVal) : undefined,
                cache: parseInt(document.getElementById('cache').value),
                cycle: document.getElementById('cycle').checked
            };
        }

        function updatePreview() {
            const seqName = document.getElementById('seqName').value.trim();
            
            if (seqName && /^[a-z_][a-z0-9_]*$/i.test(seqName)) {
                vscode.postMessage({
                    command: 'previewSql',
                    seqDef: getSequenceDefinition()
                });
            } else if (seqName) {
                document.getElementById('sqlPreview').textContent = '-- Invalid sequence name';
            } else {
                document.getElementById('sqlPreview').textContent = '-- Fill in the sequence name to see the SQL preview';
            }
        }

        function validateSequence() {
            clearError();
            
            const seqName = document.getElementById('seqName').value.trim();
            if (!seqName) {
                showError('Sequence name is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(seqName)) {
                showError('Sequence name must start with a letter or underscore and contain only letters, numbers, and underscores');
                return false;
            }
            
            const incrementBy = parseInt(document.getElementById('incrementBy').value);
            if (incrementBy === 0) {
                showError('Increment cannot be zero');
                return false;
            }
            
            return true;
        }

        // Auto-update preview on input changes
        ['seqName', 'startValue', 'incrementBy', 'minValue', 'maxValue', 'cache', 'cycle'].forEach(id => {
            const element = document.getElementById(id);
            element.addEventListener('input', updatePreview);
            element.addEventListener('change', updatePreview);
        });

        document.getElementById('createBtn').addEventListener('click', () => {
            if (!validateSequence()) return;
            vscode.postMessage({
                command: 'createSequence',
                seqDef: getSequenceDefinition()
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
     * Get HTML for alter sequence panel
     */
    private static getAlterSequenceHtml(
        schema: string,
        sequenceName: string,
        currentProps: any
    ): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Sequence</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Edit Sequence</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema</label>
                <input type="text" id="schemaInput" value="${schema}" readonly />
            </div>

            <div class="form-group">
                <label>Sequence Name <span class="required">*</span></label>
                <input type="text" id="sequenceName" value="${sequenceName}" />
                <div class="info-text">Changing the name will rename the sequence</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('optionsSection')">
                <span class="toggle-icon expanded" id="optionsIcon">▶</span>
                Sequence Options
            </div>
            <div class="collapsible-content" id="optionsSection" style="display: block;">
                <div class="form-group">
                    <label>Increment By</label>
                    <input type="number" id="incrementBy" value="${currentProps.increment}" />
                    <div class="info-text">Value to add to current sequence value (can be negative)</div>
                </div>

                <div class="form-group">
                    <label>Minimum Value</label>
                    <input type="text" id="minValue" value="${currentProps.minimum_value}" />
                    <div class="info-text">Minimum value of the sequence</div>
                </div>

                <div class="form-group">
                    <label>Maximum Value</label>
                    <input type="text" id="maxValue" value="${currentProps.maximum_value}" />
                    <div class="info-text">Maximum value of the sequence</div>
                </div>

                <div class="form-group">
                    <label>Cache Size</label>
                    <input type="number" id="cache" value="${currentProps.cache || 1}" min="1" />
                    <div class="info-text">Number of sequence values to pre-allocate (improves performance)</div>
                </div>

                <div class="checkbox-group">
                    <input type="checkbox" id="cycle" ${currentProps.cycle_option === 'YES' ? 'checked' : ''} />
                    <label for="cycle" style="margin: 0;">Cycle</label>
                </div>
                <div class="info-text">Allow sequence to wrap around when reaching max/min value</div>
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
            <button class="btn" id="alterBtn">Apply Changes</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const originalSequenceName = '${sequenceName}';

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        function getChanges() {
            const changes = {};
            
            const newSequenceName = document.getElementById('sequenceName').value.trim();
            if (newSequenceName && newSequenceName !== originalSequenceName) {
                changes.newSequenceName = newSequenceName;
            }
            
            const incrementBy = document.getElementById('incrementBy').value;
            if (incrementBy) changes.incrementBy = parseInt(incrementBy);
            
            const minValue = document.getElementById('minValue').value;
            if (minValue) changes.minValue = minValue;
            
            const maxValue = document.getElementById('maxValue').value;
            if (maxValue) changes.maxValue = maxValue;
            
            const cache = document.getElementById('cache').value;
            if (cache) changes.cache = parseInt(cache);
            
            changes.cycle = document.getElementById('cycle').checked;
            
            return changes;
        }

        function updatePreview() {
            const changes = getChanges();
            vscode.postMessage({
                command: 'previewSql',
                changes: changes
            });
        }

        // Auto-update preview on input changes
        ['sequenceName', 'incrementBy', 'minValue', 'maxValue', 'cache', 'cycle'].forEach(id => {
            const element = document.getElementById(id);
            element.addEventListener('input', updatePreview);
            element.addEventListener('change', updatePreview);
        });

        document.getElementById('alterBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'alterSequence',
                changes: getChanges()
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


