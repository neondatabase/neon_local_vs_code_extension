import * as vscode from 'vscode';
import { StateService } from './services/state.service';
import { SqlQueryService } from './services/sqlQuery.service';
import { getStyles } from './templates/styles';

export class TriggerManagementPanel {
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
            const errorMessage = error instanceof Error ? error.message : String(error);
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
            const errorMessage = error instanceof Error ? error.message : String(error);
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
        input, select, textarea {
            width: 100%;
            padding: 8px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            box-sizing: border-box;
        }
        textarea {
            min-height: 80px;
            font-family: var(--vscode-editor-font-family);
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
        .checkbox-group {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
        }
        .checkbox-item {
            display: flex;
            align-items: center;
            gap: 5px;
        }
        .checkbox-item input {
            width: auto;
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
        .help-text {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 3px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create Trigger</h1>
        <div class="info">
            Creating trigger on table: <strong>${schema}.${tableName}</strong>
        </div>

        <form id="triggerForm">
            <div class="form-group">
                <label for="triggerName">Trigger Name *</label>
                <input type="text" id="triggerName" required placeholder="tr_tablename_action">
            </div>

            <div class="form-group">
                <label for="timing">Timing *</label>
                <select id="timing" required>
                    <option value="BEFORE">BEFORE - Execute before the event</option>
                    <option value="AFTER">AFTER - Execute after the event</option>
                    <option value="INSTEAD OF">INSTEAD OF - Replace the event (views only)</option>
                </select>
            </div>

            <div class="form-group">
                <label>Events * (select at least one)</label>
                <div class="checkbox-group">
                    <div class="checkbox-item">
                        <input type="checkbox" id="eventInsert" value="INSERT">
                        <label for="eventInsert">INSERT</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="eventUpdate" value="UPDATE">
                        <label for="eventUpdate">UPDATE</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="eventDelete" value="DELETE">
                        <label for="eventDelete">DELETE</label>
                    </div>
                    <div class="checkbox-item">
                        <input type="checkbox" id="eventTruncate" value="TRUNCATE">
                        <label for="eventTruncate">TRUNCATE</label>
                    </div>
                </div>
            </div>

            <div class="form-group">
                <label for="level">Trigger Level *</label>
                <select id="level" required>
                    <option value="ROW">FOR EACH ROW - Execute once per affected row</option>
                    <option value="STATEMENT">FOR EACH STATEMENT - Execute once per statement</option>
                </select>
            </div>

            <div class="form-group">
                <label for="whenCondition">WHEN Condition (optional)</label>
                <textarea id="whenCondition" placeholder="e.g., NEW.status != OLD.status"></textarea>
                <div class="help-text">Optional condition to filter when trigger executes. Use OLD and NEW to reference row values.</div>
            </div>

            <div class="form-group">
                <label for="triggerFunction">Trigger Function *</label>
                <select id="triggerFunction" required>
                    <option value="">Select a function...</option>
                </select>
                <div class="help-text">Function must return type 'trigger'</div>
            </div>

            <div class="form-group">
                <label for="functionArgs">Function Arguments (optional)</label>
                <input type="text" id="functionArgs" placeholder="'arg1', 'arg2'">
                <div class="help-text">Comma-separated arguments to pass to the trigger function</div>
            </div>

            <div style="margin-top: 30px;">
                <button type="button" class="btn btn-secondary" onclick="previewSql()">Preview SQL</button>
                <button type="submit" class="btn btn-primary">Create Trigger</button>
            </div>

            <div id="sqlPreview" class="sql-preview"></div>
            <div id="error" class="error" style="display: none;"></div>
        </form>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const functions = ${functionsJson};
        const columns = ${columnsJson};
        
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

        function previewSql() {
            try {
                const triggerDef = getFormData();
                vscode.postMessage({ command: 'previewSql', triggerDef });
            } catch (error) {
                showError(error.message);
            }
        }

        document.getElementById('triggerForm').addEventListener('submit', (e) => {
            e.preventDefault();
            
            try {
                const triggerDef = getFormData();
                vscode.postMessage({ command: 'createTrigger', triggerDef });
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
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }
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
<html>
<head>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            padding: 20px;
        }
        .container {
            max-width: 900px;
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
        .code-block {
            background-color: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 15px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            white-space: pre-wrap;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Trigger: ${trigger.trigger_name}</h1>

        <div class="section">
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

        <div class="section">
            <h2>Trigger Definition</h2>
            <div class="code-block">${trigger.trigger_definition}</div>
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


