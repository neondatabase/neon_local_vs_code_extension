import * as vscode from 'vscode';
import { StateService } from './services/state.service';
import { SqlQueryService } from './services/sqlQuery.service';
import { getStyles } from './templates/styles';

export class TriggerManagementPanel {
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
     * Create a new trigger
     */
    public static async createTrigger(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `create_trigger_${database}.${schema}.${tableName}`;
        
        if (TriggerManagementPanel.currentPanels.has(key)) {
            TriggerManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createTrigger',
            `Create Trigger: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        TriggerManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            TriggerManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get available functions that can be used as trigger functions
            const functionsResult = await sqlService.executeQuery(`
                SELECT 
                    p.proname as function_name,
                    n.nspname as schema_name,
                    pg_get_function_identity_arguments(p.oid) as arguments
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE p.prorettype = 'trigger'::regtype
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY n.nspname, p.proname
            `, [], database);

            // Get table columns for WHEN clause suggestions
            const columnsResult = await sqlService.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, tableName], database);

            panel.webview.html = TriggerManagementPanel.getCreateTriggerHtml(
                schema,
                tableName,
                functionsResult.rows,
                columnsResult.rows
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createTrigger':
                        await TriggerManagementPanel.executeCreateTrigger(
                            context,
                            stateService,
                            schema,
                            tableName,
                            message.triggerDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = TriggerManagementPanel.generateCreateTriggerSql(
                            schema,
                            tableName,
                            message.triggerDef
                        );
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load trigger creation form: ${error}`);
            panel.dispose();
        }
    }

    /**
     * View trigger properties
     */
    public static async viewTriggerProperties(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        triggerName: string,
        database?: string
    ): Promise<void> {
        const key = `view_trigger_${database}.${schema}.${tableName}.${triggerName}`;
        
        if (TriggerManagementPanel.currentPanels.has(key)) {
            TriggerManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'viewTrigger',
            `Trigger: ${triggerName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        TriggerManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            TriggerManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get detailed trigger information
            const triggerResult = await sqlService.executeQuery(`
                SELECT 
                    t.tgname as trigger_name,
                    pg_get_triggerdef(t.oid) as trigger_definition,
                    t.tgenabled as is_enabled,
                    t.tgisinternal as is_internal,
                    CASE t.tgtype::int & 1
                        WHEN 1 THEN 'ROW'
                        ELSE 'STATEMENT'
                    END as level,
                    CASE t.tgtype::int & 66
                        WHEN 2 THEN 'BEFORE'
                        WHEN 64 THEN 'INSTEAD OF'
                        ELSE 'AFTER'
                    END as timing,
                    CASE 
                        WHEN t.tgtype::int & 4 != 0 THEN 'INSERT'
                        WHEN t.tgtype::int & 8 != 0 THEN 'DELETE'
                        WHEN t.tgtype::int & 16 != 0 THEN 'UPDATE'
                        WHEN t.tgtype::int & 32 != 0 THEN 'TRUNCATE'
                    END as event,
                    p.proname as function_name,
                    n.nspname as function_schema,
                    c.relname as table_name,
                    ns.nspname as table_schema,
                    obj_description(t.oid, 'pg_trigger') as description
                FROM pg_trigger t
                JOIN pg_class c ON t.tgrelid = c.oid
                JOIN pg_namespace ns ON c.relnamespace = ns.oid
                JOIN pg_proc p ON t.tgfoid = p.oid
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE t.tgname = $1
                    AND ns.nspname = $2
                    AND c.relname = $3
                    AND NOT t.tgisinternal
            `, [triggerName, schema, tableName], database);

            if (triggerResult.rows.length === 0) {
                vscode.window.showWarningMessage(`Trigger "${triggerName}" not found.`);
                panel.dispose();
                return;
            }

            panel.webview.html = TriggerManagementPanel.getViewTriggerPropertiesHtml(triggerResult.rows[0]);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load trigger properties: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Edit an existing trigger
     */
    public static async editTrigger(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        triggerName: string,
        database?: string
    ): Promise<void> {
        const key = `edit_trigger_${database}.${schema}.${tableName}.${triggerName}`;
        
        if (TriggerManagementPanel.currentPanels.has(key)) {
            TriggerManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'editTrigger',
            `Edit Trigger: ${triggerName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        TriggerManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            TriggerManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get current trigger information
            const triggerResult = await sqlService.executeQuery(`
                SELECT 
                    t.tgname as trigger_name,
                    pg_get_triggerdef(t.oid) as trigger_definition,
                    t.tgenabled as is_enabled,
                    CASE t.tgtype::int & 1
                        WHEN 1 THEN 'ROW'
                        ELSE 'STATEMENT'
                    END as level,
                    CASE t.tgtype::int & 66
                        WHEN 2 THEN 'BEFORE'
                        WHEN 64 THEN 'INSTEAD OF'
                        ELSE 'AFTER'
                    END as timing,
                    ARRAY(
                        SELECT CASE 
                            WHEN t.tgtype::int & 4 != 0 THEN 'INSERT'
                            WHEN t.tgtype::int & 8 != 0 THEN 'DELETE'
                            WHEN t.tgtype::int & 16 != 0 THEN 'UPDATE'
                            WHEN t.tgtype::int & 32 != 0 THEN 'TRUNCATE'
                        END
                    ) as events,
                    p.proname as function_name,
                    n.nspname as function_schema,
                    (t.tgtype::int & 4) != 0 as has_insert,
                    (t.tgtype::int & 8) != 0 as has_delete,
                    (t.tgtype::int & 16) != 0 as has_update,
                    (t.tgtype::int & 32) != 0 as has_truncate,
                    pg_get_expr(t.tgqual, t.tgrelid) as when_condition
                FROM pg_trigger t
                JOIN pg_class c ON t.tgrelid = c.oid
                JOIN pg_namespace ns ON c.relnamespace = ns.oid
                JOIN pg_proc p ON t.tgfoid = p.oid
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE t.tgname = $1
                    AND ns.nspname = $2
                    AND c.relname = $3
                    AND NOT t.tgisinternal
            `, [triggerName, schema, tableName], database);

            if (triggerResult.rows.length === 0) {
                vscode.window.showWarningMessage(`Trigger "${triggerName}" not found.`);
                panel.dispose();
                return;
            }

            const triggerInfo = triggerResult.rows[0];

            // Get available functions
            const functionsResult = await sqlService.executeQuery(`
                SELECT 
                    p.proname as function_name,
                    n.nspname as schema_name,
                    pg_get_function_identity_arguments(p.oid) as arguments
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE p.prorettype = 'trigger'::regtype
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                ORDER BY n.nspname, p.proname
            `, [], database);

            // Get table columns
            const columnsResult = await sqlService.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, tableName], database);

            panel.webview.html = TriggerManagementPanel.getEditTriggerHtml(
                schema,
                tableName,
                triggerName,
                triggerInfo,
                functionsResult.rows,
                columnsResult.rows
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'editTrigger':
                        await TriggerManagementPanel.executeEditTrigger(
                            context,
                            stateService,
                            schema,
                            tableName,
                            triggerName,
                            message.triggerDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = TriggerManagementPanel.generateEditTriggerSql(
                            schema,
                            tableName,
                            triggerName,
                            message.triggerDef
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
            vscode.window.showErrorMessage(`Failed to load trigger: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Enable/Disable a trigger
     */
    public static async toggleTrigger(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        triggerName: string,
        enable: boolean,
        database?: string
    ): Promise<void> {
        try {
            const action = enable ? 'ENABLE' : 'DISABLE';
            const sql = `ALTER TABLE ${schema}.${tableName} ${action} TRIGGER ${triggerName};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            const status = enable ? 'enabled' : 'disabled';
            vscode.window.showInformationMessage(`Trigger "${triggerName}" ${status} successfully!`);
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to ${enable ? 'enable' : 'disable'} trigger: ${errorMessage}`);
        }
    }

    /**
     * Drop a trigger
     */
    public static async dropTrigger(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        triggerName: string,
        cascade: boolean,
        database?: string
    ): Promise<void> {
        try {
            const cascadeStr = cascade ? ' CASCADE' : '';
            const sql = `DROP TRIGGER ${triggerName} ON ${schema}.${tableName}${cascadeStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Trigger "${triggerName}" dropped successfully!`);
            
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
            
            vscode.window.showErrorMessage(`Failed to drop trigger: ${errorMessage}`);
        }
    }

    /**
     * Execute trigger creation
     */
    private static async executeCreateTrigger(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        triggerDef: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = TriggerManagementPanel.generateCreateTriggerSql(schema, tableName, triggerDef);
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Trigger "${triggerDef.name}" created successfully!`);
            
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
     * Generate CREATE TRIGGER SQL
     */
    private static generateCreateTriggerSql(schema: string, tableName: string, triggerDef: any): string {
        const {
            name,
            timing,
            events,
            level,
            whenCondition,
            functionSchema,
            functionName,
            functionArgs
        } = triggerDef;

        let sql = `CREATE TRIGGER ${name}\n`;
        sql += `  ${timing} ${events.join(' OR ')}\n`;
        sql += `  ON ${schema}.${tableName}\n`;
        sql += `  FOR EACH ${level}`;
        
        if (whenCondition && whenCondition.trim()) {
            sql += `\n  WHEN (${whenCondition})`;
        }
        
        sql += `\n  EXECUTE FUNCTION ${functionSchema}.${functionName}(`;
        
        if (functionArgs && functionArgs.trim()) {
            sql += functionArgs;
        }
        
        sql += ');';
        
        return sql;
    }

    /**
     * Execute trigger edit
     */
    private static async executeEditTrigger(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        oldTriggerName: string,
        triggerDef: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = TriggerManagementPanel.generateEditTriggerSql(schema, tableName, oldTriggerName, triggerDef);
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Trigger "${triggerDef.name}" updated successfully!`);
            
            // Refresh the schema view
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
                message: errorMessage
            });
        }
    }

    /**
     * Generate EDIT TRIGGER SQL (DROP + CREATE)
     */
    private static generateEditTriggerSql(schema: string, tableName: string, oldTriggerName: string, triggerDef: any): string {
        // Drop the old trigger
        let sql = `DROP TRIGGER IF EXISTS "${oldTriggerName}" ON "${schema}"."${tableName}";\n\n`;
        
        // Create the new trigger
        sql += TriggerManagementPanel.generateCreateTriggerSql(schema, tableName, triggerDef);
        
        return sql;
    }

    /**
     * Get HTML for create trigger panel
     */
    private static getCreateTriggerHtml(
        schema: string,
        tableName: string,
        functions: any[],
        columns: any[]
    ): string {
        const functionsJson = JSON.stringify(functions);
        const columnsJson = JSON.stringify(columns);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Trigger</title>
    ${getStyles()}
    <style>
        .events-checkboxes {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create Trigger on ${schema}.${tableName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label for="triggerName">Trigger Name <span class="required">*</span></label>
                <input type="text" id="triggerName" placeholder="tr_tablename_action" />
                <div class="info-text">Naming convention: tr_tablename_action (e.g., tr_users_update)</div>
            </div>

            <div class="form-group">
                <label for="timing">Timing <span class="required">*</span></label>
                <select id="timing">
                    <option value="BEFORE">BEFORE - Execute before the event</option>
                    <option value="AFTER">AFTER - Execute after the event</option>
                    <option value="INSTEAD OF">INSTEAD OF - Replace the event (views only)</option>
                </select>
                <div class="info-text">When the trigger fires relative to the event</div>
            </div>

            <div class="form-group">
                <label>Events <span class="required">*</span></label>
                <div class="events-checkboxes">
                    <div class="checkbox-group">
                        <input type="checkbox" id="eventInsert" value="INSERT">
                        <label for="eventInsert" style="margin: 0;">INSERT</label>
                    </div>
                    <div class="checkbox-group">
                        <input type="checkbox" id="eventUpdate" value="UPDATE">
                        <label for="eventUpdate" style="margin: 0;">UPDATE</label>
                    </div>
                    <div class="checkbox-group">
                        <input type="checkbox" id="eventDelete" value="DELETE">
                        <label for="eventDelete" style="margin: 0;">DELETE</label>
                    </div>
                    <div class="checkbox-group">
                        <input type="checkbox" id="eventTruncate" value="TRUNCATE">
                        <label for="eventTruncate" style="margin: 0;">TRUNCATE</label>
                    </div>
                </div>
                <div class="info-text">Select at least one event that will fire the trigger</div>
            </div>

            <div class="form-group">
                <label for="level">Trigger Level <span class="required">*</span></label>
                <select id="level">
                    <option value="ROW">FOR EACH ROW - Execute once per affected row</option>
                    <option value="STATEMENT">FOR EACH STATEMENT - Execute once per statement</option>
                </select>
                <div class="info-text">Whether to fire once per row or once per statement</div>
            </div>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 12px; font-weight: 500;">Trigger Function</div>
            
            <div class="form-group">
                <label for="triggerFunction">Function <span class="required">*</span></label>
                <select id="triggerFunction">
                    <option value="">-- Select a function --</option>
                </select>
                <div class="info-text">Function must return type TRIGGER</div>
            </div>

            <div class="form-group">
                <label for="functionArgs">Function Arguments (Optional)</label>
                <input type="text" id="functionArgs" placeholder="'arg1', 'arg2'" />
                <div class="info-text">Comma-separated arguments to pass to the trigger function</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('conditionSection')">
                <span class="toggle-icon" id="conditionIcon">▶</span>
                WHEN Condition (Optional)
            </div>
            <div class="collapsible-content" id="conditionSection">
                <div class="form-group">
                    <label for="whenCondition">Condition Expression</label>
                    <textarea id="whenCondition" rows="3" placeholder="e.g., NEW.status != OLD.status"></textarea>
                    <div class="info-text">Boolean expression to filter when trigger executes. Use OLD and NEW to reference row values.</div>
                </div>
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
            <button class="btn" id="createBtn">Create Trigger</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const functions = ${functionsJson};
        const columns = ${columnsJson};

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.textContent = isExpanded ? '▶' : '▼';
        }

        window.toggleSection = toggleSection;
        
        // Populate functions dropdown
        const functionSelect = document.getElementById('triggerFunction');
        functions.forEach(func => {
            const option = document.createElement('option');
            const funcDisplay = \`\${func.schema_name}.\${func.function_name}\`;
            option.value = JSON.stringify({ schema: func.schema_name, name: func.function_name });
            option.textContent = funcDisplay;
            functionSelect.appendChild(option);
        });

        function getFormData() {
            const name = document.getElementById('triggerName').value.trim();
            if (!name) {
                throw new Error('Trigger name is required');
            }

            const timing = document.getElementById('timing').value;
            
            const events = [];
            if (document.getElementById('eventInsert').checked) events.push('INSERT');
            if (document.getElementById('eventUpdate').checked) events.push('UPDATE');
            if (document.getElementById('eventDelete').checked) events.push('DELETE');
            if (document.getElementById('eventTruncate').checked) events.push('TRUNCATE');
            
            if (events.length === 0) {
                throw new Error('Please select at least one event');
            }

            const level = document.getElementById('level').value;
            const whenCondition = document.getElementById('whenCondition').value.trim();
            
            const functionValue = document.getElementById('triggerFunction').value;
            if (!functionValue) {
                throw new Error('Please select a trigger function');
            }
            
            const functionInfo = JSON.parse(functionValue);
            const functionArgs = document.getElementById('functionArgs').value.trim();
            
            return {
                name,
                timing,
                events,
                level,
                whenCondition,
                functionSchema: functionInfo.schema,
                functionName: functionInfo.name,
                functionArgs
            };
        }

        function updatePreview() {
            try {
                const triggerDef = getFormData();
                vscode.postMessage({ command: 'previewSql', triggerDef });
            } catch (error) {
                document.getElementById('sqlPreview').textContent = '-- Fill in required fields to generate SQL preview';
            }
        }

        // Auto-update preview on input changes
        document.getElementById('triggerName').addEventListener('input', updatePreview);
        document.getElementById('timing').addEventListener('change', updatePreview);
        document.getElementById('eventInsert').addEventListener('change', updatePreview);
        document.getElementById('eventUpdate').addEventListener('change', updatePreview);
        document.getElementById('eventDelete').addEventListener('change', updatePreview);
        document.getElementById('eventTruncate').addEventListener('change', updatePreview);
        document.getElementById('level').addEventListener('change', updatePreview);
        document.getElementById('triggerFunction').addEventListener('change', updatePreview);
        document.getElementById('functionArgs').addEventListener('input', updatePreview);
        document.getElementById('whenCondition').addEventListener('input', updatePreview);

        document.getElementById('createBtn').addEventListener('click', () => {
            try {
                const triggerDef = getFormData();
                vscode.postMessage({ command: 'createTrigger', triggerDef });
            } catch (error) {
                showError(error.message);
            }
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'sqlPreview') {
                document.getElementById('sqlPreview').textContent = message.sql;
            } else if (message.command === 'error') {
                showError(message.message);
            }
        });

        function showError(message) {
            const errorContainer = document.getElementById('errorContainer');
            errorContainer.innerHTML = '<div class="error">' + message + '</div>';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Initialize preview
        updatePreview();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for viewing trigger properties
     */
    private static getViewTriggerPropertiesHtml(trigger: any): string {
        const isEnabled = trigger.is_enabled === 'O' || trigger.is_enabled === 't';
        const statusBadge = isEnabled 
            ? '<span style="color: var(--vscode-testing-iconPassed);">✓ Enabled</span>'
            : '<span style="color: var(--vscode-errorForeground);">✗ Disabled</span>';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trigger Properties</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Trigger: ${trigger.trigger_name}</h1>

        <div class="section-box">
            <h2>General Information</h2>
            <table class="property-table">
                <tr>
                    <td class="label">Trigger Name</td>
                    <td>${trigger.trigger_name}</td>
                </tr>
                <tr>
                    <td class="label">Status</td>
                    <td>${statusBadge}</td>
                </tr>
                <tr>
                    <td class="label">Table</td>
                    <td>${trigger.table_schema}.${trigger.table_name}</td>
                </tr>
                <tr>
                    <td class="label">Timing</td>
                    <td>${trigger.timing}</td>
                </tr>
                <tr>
                    <td class="label">Event</td>
                    <td>${trigger.event}</td>
                </tr>
                <tr>
                    <td class="label">Level</td>
                    <td>FOR EACH ${trigger.level}</td>
                </tr>
                <tr>
                    <td class="label">Trigger Function</td>
                    <td>${trigger.function_schema}.${trigger.function_name}()</td>
                </tr>
            </table>
        </div>

        <div class="section-box">
            <h2>Trigger Definition</h2>
            <pre class="sql-preview">${trigger.trigger_definition}</pre>
        </div>
    </div>
</body>
</html>`;
    }

    /**
     * Get HTML for edit trigger panel
     */
    private static getEditTriggerHtml(
        schema: string,
        tableName: string,
        triggerName: string,
        triggerInfo: any,
        functions: any[],
        columns: any[]
    ): string {
        const functionsJson = JSON.stringify(functions);
        const columnsJson = JSON.stringify(columns);
        
        // Build the function select options
        const functionOptions = functions.map(f => {
            const fullName = `${f.schema_name}.${f.function_name}`;
            const currentFunction = `${triggerInfo.function_schema}.${triggerInfo.function_name}`;
            const selected = fullName === currentFunction ? 'selected' : '';
            return `<option value="${fullName}" ${selected}>${fullName}</option>`;
        }).join('\n');
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Trigger</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Edit Trigger</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Trigger Name <span class="required">*</span></label>
                <input type="text" id="triggerName" value="${triggerName}" placeholder="my_trigger" />
                <div class="info-text">Rename trigger by changing the name</div>
            </div>

            <div class="form-group">
                <label>Timing <span class="required">*</span></label>
                <select id="timing">
                    <option value="BEFORE" ${triggerInfo.timing === 'BEFORE' ? 'selected' : ''}>BEFORE</option>
                    <option value="AFTER" ${triggerInfo.timing === 'AFTER' ? 'selected' : ''}>AFTER</option>
                    <option value="INSTEAD OF" ${triggerInfo.timing === 'INSTEAD OF' ? 'selected' : ''}>INSTEAD OF</option>
                </select>
                <div class="info-text">When the trigger fires relative to the event</div>
            </div>

            <div class="form-group">
                <label>Events <span class="required">*</span></label>
                <div class="checkbox-group">
                    <input type="checkbox" id="eventInsert" ${triggerInfo.has_insert ? 'checked' : ''} />
                    <label for="eventInsert" style="margin: 0;">INSERT</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="eventUpdate" ${triggerInfo.has_update ? 'checked' : ''} />
                    <label for="eventUpdate" style="margin: 0;">UPDATE</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="eventDelete" ${triggerInfo.has_delete ? 'checked' : ''} />
                    <label for="eventDelete" style="margin: 0;">DELETE</label>
                </div>
                <div class="checkbox-group">
                    <input type="checkbox" id="eventTruncate" ${triggerInfo.has_truncate ? 'checked' : ''} />
                    <label for="eventTruncate" style="margin: 0;">TRUNCATE</label>
                </div>
                <div class="info-text">One or more events that activate the trigger</div>
            </div>

            <div class="form-group">
                <label>Level <span class="required">*</span></label>
                <select id="level">
                    <option value="ROW" ${triggerInfo.level === 'ROW' ? 'selected' : ''}>FOR EACH ROW</option>
                    <option value="STATEMENT" ${triggerInfo.level === 'STATEMENT' ? 'selected' : ''}>FOR EACH STATEMENT</option>
                </select>
                <div class="info-text">Execute once per affected row or once per statement</div>
            </div>

            <div class="form-group">
                <label>Trigger Function <span class="required">*</span></label>
                <select id="function">
                    ${functionOptions}
                </select>
                <div class="info-text">The function to execute when the trigger fires</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('advancedSection')">
                <span class="toggle-icon" id="advancedIcon">▶</span>
                Advanced Options
            </div>
            <div class="collapsible-content" id="advancedSection">
                <div class="form-group">
                    <label>WHEN Condition (Optional)</label>
                    <textarea id="whenCondition" rows="3" placeholder="e.g., NEW.status != OLD.status">${triggerInfo.when_condition || ''}</textarea>
                    <div class="info-text">Boolean expression to determine if the trigger should fire</div>
                </div>

                <div class="form-group">
                    <label>Function Arguments (Optional)</label>
                    <input type="text" id="functionArgs" placeholder="'arg1', 'arg2'" />
                    <div class="info-text">Arguments to pass to the trigger function</div>
                </div>
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
        const functions = ${functionsJson};
        const columns = ${columnsJson};

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        const triggerNameInput = document.getElementById('triggerName');
        const timingSelect = document.getElementById('timing');
        const eventInsertCheckbox = document.getElementById('eventInsert');
        const eventUpdateCheckbox = document.getElementById('eventUpdate');
        const eventDeleteCheckbox = document.getElementById('eventDelete');
        const eventTruncateCheckbox = document.getElementById('eventTruncate');
        const levelSelect = document.getElementById('level');
        const functionSelect = document.getElementById('function');
        const whenConditionInput = document.getElementById('whenCondition');
        const functionArgsInput = document.getElementById('functionArgs');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        function getTriggerDefinition() {
            const functionParts = functionSelect.value.split('.');
            const events = [];
            if (eventInsertCheckbox.checked) events.push('INSERT');
            if (eventUpdateCheckbox.checked) events.push('UPDATE');
            if (eventDeleteCheckbox.checked) events.push('DELETE');
            if (eventTruncateCheckbox.checked) events.push('TRUNCATE');

            return {
                name: triggerNameInput.value.trim(),
                timing: timingSelect.value,
                events: events,
                level: levelSelect.value,
                whenCondition: whenConditionInput.value.trim(),
                functionSchema: functionParts[0],
                functionName: functionParts[1],
                functionArgs: functionArgsInput.value.trim()
            };
        }

        function validateTrigger(showErrors = true) {
            if (showErrors) {
                clearError();
            }

            if (!triggerNameInput.value.trim()) {
                if (showErrors) showError('Trigger name is required');
                return false;
            }

            if (!/^[a-z_][a-z0-9_]*$/i.test(triggerNameInput.value.trim())) {
                if (showErrors) showError('Trigger name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }

            const events = [];
            if (eventInsertCheckbox.checked) events.push('INSERT');
            if (eventUpdateCheckbox.checked) events.push('UPDATE');
            if (eventDeleteCheckbox.checked) events.push('DELETE');
            if (eventTruncateCheckbox.checked) events.push('TRUNCATE');

            if (events.length === 0) {
                if (showErrors) showError('At least one event must be selected');
                return false;
            }

            if (!functionSelect.value) {
                if (showErrors) showError('Trigger function is required');
                return false;
            }

            return true;
        }

        function updatePreview() {
            if (!validateTrigger(false)) {
                document.getElementById('sqlPreview').textContent = '-- Fill in required fields to generate SQL preview';
                return;
            }
            vscode.postMessage({
                command: 'previewSql',
                triggerDef: getTriggerDefinition()
            });
        }

        // Auto-update preview
        triggerNameInput.addEventListener('input', updatePreview);
        timingSelect.addEventListener('change', updatePreview);
        eventInsertCheckbox.addEventListener('change', updatePreview);
        eventUpdateCheckbox.addEventListener('change', updatePreview);
        eventDeleteCheckbox.addEventListener('change', updatePreview);
        eventTruncateCheckbox.addEventListener('change', updatePreview);
        levelSelect.addEventListener('change', updatePreview);
        functionSelect.addEventListener('change', updatePreview);
        whenConditionInput.addEventListener('input', updatePreview);
        functionArgsInput.addEventListener('input', updatePreview);

        saveBtn.addEventListener('click', () => {
            if (!validateTrigger(true)) return;
            vscode.postMessage({
                command: 'editTrigger',
                triggerDef: getTriggerDefinition()
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
                    showError(message.message);
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


