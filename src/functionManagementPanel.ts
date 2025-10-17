import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { getStyles } from './templates/styles';

export interface FunctionDefinition {
    schema: string;
    functionName: string;
    parameters: FunctionParameter[];
    returnType: string;
    language: string;
    body: string;
    isVolatile: boolean;
    securityDefiner: boolean;
    replaceIfExists: boolean;
}

export interface FunctionParameter {
    name: string;
    type: string;
    mode: 'IN' | 'OUT' | 'INOUT';
    defaultValue?: string;
}

export class FunctionManagementPanel {
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
     * Create a new function/procedure
     */
    public static async createFunction(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        database?: string
    ): Promise<void> {
        const key = `create_func_${database || 'default'}.${schema}`;
        
        if (FunctionManagementPanel.currentPanels.has(key)) {
            FunctionManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createFunction',
            `Create Function: ${schema}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        FunctionManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            FunctionManagementPanel.currentPanels.delete(key);
        });

        panel.webview.html = FunctionManagementPanel.getCreateFunctionHtml(schema);

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'createFunction':
                    await FunctionManagementPanel.executeCreateFunction(
                        context,
                        stateService,
                        message.funcDef,
                        database,
                        panel
                    );
                    break;
                case 'previewSql':
                    const sql = FunctionManagementPanel.generateCreateFunctionSql(message.funcDef);
                    panel.webview.postMessage({ command: 'sqlPreview', sql });
                    break;
                case 'cancel':
                    panel.dispose();
                    break;
            }
        });
    }

    /**
     * Edit an existing function
     */
    public static async editFunction(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        functionName: string,
        database?: string
    ): Promise<void> {
        const key = `edit_func_${database || 'default'}.${schema}.${functionName}`;
        
        if (FunctionManagementPanel.currentPanels.has(key)) {
            FunctionManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'editFunction',
            `Edit Function: ${schema}.${functionName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        FunctionManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            FunctionManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get function definition
            const result = await sqlService.executeQuery(`
                SELECT 
                    p.proname as name,
                    pg_get_functiondef(p.oid) as definition,
                    pg_get_function_arguments(p.oid) as arguments,
                    pg_get_function_result(p.oid) as return_type,
                    l.lanname as language,
                    p.provolatile as volatility,
                    p.prosecdef as security_definer
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                JOIN pg_language l ON p.prolang = l.oid
                WHERE n.nspname = $1 AND p.proname = $2
                LIMIT 1
            `, [schema, functionName], database);

            if (result.rows.length === 0) {
                throw new Error('Function not found');
            }

            const funcData = result.rows[0];
            
            // Debug: Log retrieved function data
            console.log('[Edit Function] Retrieved function data:', {
                schema,
                functionName,
                returnType: funcData.return_type,
                language: funcData.language,
                definitionLength: funcData.definition?.length || 0,
                argumentsLength: funcData.arguments?.length || 0,
                volatility: funcData.volatility,
                securityDefiner: funcData.security_definer
            });
            
            panel.webview.html = FunctionManagementPanel.getEditFunctionHtml(
                schema,
                functionName,
                funcData.definition,
                funcData.arguments,
                funcData.return_type,
                funcData.language,
                funcData.volatility,
                funcData.security_definer
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'updateFunction':
                        await FunctionManagementPanel.executeCreateFunction(
                            context,
                            stateService,
                            message.funcDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = FunctionManagementPanel.generateCreateFunctionSql(message.funcDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load function: ${error}`);
            panel.dispose();
        }
    }

    /**
     * Quote a PostgreSQL identifier to preserve case and handle special characters
     */
    private static quoteIdentifier(identifier: string): string {
        // Escape any double quotes by doubling them
        const escaped = identifier.replace(/"/g, '""');
        // Wrap in double quotes
        return `"${escaped}"`;
    }

    /**
     * Drop a function
     */
    public static async dropFunction(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        functionName: string,
        cascade: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const cascadeStr = cascade ? ' CASCADE' : ' RESTRICT';
            const sql = `DROP FUNCTION ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(functionName)}${cascadeStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Function "${functionName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to drop function: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Execute create/update function
     */
    private static async executeCreateFunction(
        context: vscode.ExtensionContext,
        stateService: StateService,
        funcDef: FunctionDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = FunctionManagementPanel.generateCreateFunctionSql(funcDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Function "${funcDef.functionName}" created successfully!`);
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
     * Generate CREATE FUNCTION SQL
     */
    private static generateCreateFunctionSql(funcDef: FunctionDefinition): string {
        const {
            schema,
            functionName,
            parameters,
            returnType,
            language,
            body,
            isVolatile,
            securityDefiner,
            replaceIfExists
        } = funcDef;

        let sql = replaceIfExists ? 'CREATE OR REPLACE FUNCTION ' : 'CREATE FUNCTION ';
        sql += `${schema}.${functionName}(`;
        
        // Add parameters
        if (parameters && parameters.length > 0) {
            sql += parameters.map(param => {
                let paramStr = '';
                if (param.mode && param.mode !== 'IN') {
                    paramStr += param.mode + ' ';
                }
                if (param.name) {
                    paramStr += param.name + ' ';
                }
                paramStr += param.type;
                if (param.defaultValue) {
                    paramStr += ' DEFAULT ' + param.defaultValue;
                }
                return paramStr;
            }).join(', ');
        }
        
        sql += ')\n';
        sql += `RETURNS ${returnType}\n`;
        sql += `LANGUAGE ${language}\n`;
        
        // Add volatility
        if (isVolatile) {
            sql += 'VOLATILE\n';
        } else {
            sql += 'STABLE\n';
        }
        
        // Add security
        if (securityDefiner) {
            sql += 'SECURITY DEFINER\n';
        }
        
        sql += 'AS $$\n';
        // Wrap body in BEGIN...END block
        sql += 'BEGIN\n';
        sql += body.trim();
        if (!body.trim().endsWith(';')) {
            sql += '\n';
        }
        sql += '\nEND;\n';
        sql += '$$;';
        
        return sql;
    }

    /**
     * Get HTML for create function panel
     */
    private static getCreateFunctionHtml(schema: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Function</title>
    ${getStyles()}
    <style>
        /* Function-specific styles */
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
        .parameter-item {
            display: grid;
            grid-template-columns: 80px 1fr 1fr 1fr 40px;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }
        .param-mode, .param-name, .param-type, .param-default {
            padding: 6px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
            height: 32px;
            box-sizing: border-box;
        }
        /* Styling for disabled/readonly fields */
        .param-mode:disabled, .param-type:disabled,
        .param-name[readonly], .param-default[readonly] {
            background-color: var(--vscode-input-background);
            opacity: 0.6;
            cursor: not-allowed;
            color: var(--vscode-descriptionForeground);
        }
        .btn-remove {
            background-color: var(--vscode-errorForeground);
            color: white;
            border: none;
            border-radius: 3px;
            padding: 0;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            height: 32px;
            width: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-remove:hover {
            opacity: 0.8;
        }
        select.param-type {
            cursor: pointer;
        }
        select.param-type:disabled, select.param-mode:disabled {
            cursor: not-allowed;
        }
        .function-body-editor {
            display: flex;
            flex-direction: column;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
        }
        .function-body-editor .code-line {
            padding: 8px 12px;
            color: var(--vscode-input-foreground);
            background-color: var(--vscode-input-background);
        }
        .function-body-editor .readonly {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            opacity: 0.7;
            user-select: none;
        }
        .function-body-editor textarea {
            border: none;
            border-top: 1px solid var(--vscode-input-border);
            border-bottom: 1px solid var(--vscode-input-border);
            border-radius: 0;
            min-height: 200px;
            resize: vertical;
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
            padding: 8px 12px;
            line-height: 1.5;
        }
        .function-body-editor textarea:focus {
            outline: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create Function in ${schema}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Function Name <span class="required">*</span></label>
                <input type="text" id="functionName" placeholder="my_function" />
                <div class="info-text">Naming convention: lowercase with underscores</div>
            </div>

            <div class="form-group">
                <label>Return Type <span class="required">*</span></label>
                <select id="returnType">
                    <option value="">-- Select Return Type --</option>
                    <optgroup label="Common Types">
                        <option value="VOID">VOID (No return value)</option>
                        <option value="INTEGER">INTEGER</option>
                        <option value="BIGINT">BIGINT</option>
                        <option value="NUMERIC">NUMERIC</option>
                        <option value="REAL">REAL</option>
                        <option value="DOUBLE PRECISION">DOUBLE PRECISION</option>
                        <option value="TEXT">TEXT</option>
                        <option value="VARCHAR">VARCHAR</option>
                        <option value="CHAR">CHAR</option>
                        <option value="BOOLEAN">BOOLEAN</option>
                        <option value="DATE">DATE</option>
                        <option value="TIME">TIME</option>
                        <option value="TIMESTAMP">TIMESTAMP</option>
                        <option value="TIMESTAMPTZ">TIMESTAMPTZ</option>
                        <option value="UUID">UUID</option>
                        <option value="JSON">JSON</option>
                        <option value="JSONB">JSONB</option>
                    </optgroup>
                    <optgroup label="Array Types">
                        <option value="INTEGER[]">INTEGER[]</option>
                        <option value="TEXT[]">TEXT[]</option>
                        <option value="JSONB[]">JSONB[]</option>
                    </optgroup>
                    <optgroup label="Special">
                        <option value="TRIGGER">TRIGGER (For trigger functions)</option>
                        <option value="RECORD">RECORD</option>
                        <option value="SETOF RECORD">SETOF RECORD</option>
                        <option value="TABLE">TABLE</option>
                    </optgroup>
                </select>
                <div class="info-text">Use VOID for procedures, TRIGGER for trigger functions</div>
            </div>

            <div class="form-group">
                <label>Language</label>
                <select id="language">
                    <option value="plpgsql">PL/pgSQL (Procedural)</option>
                    <option value="sql">SQL</option>
                </select>
                <div class="info-text">PL/pgSQL is recommended for complex functions with variables and control structures. SQL is for simple functions.</div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="replaceIfExists" checked />
                <label for="replaceIfExists" style="margin: 0;">CREATE OR REPLACE</label>
            </div>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 12px; font-weight: 500;">Parameters</div>
            <div class="info-text" style="margin-bottom: 12px;">Add input/output parameters for your function</div>
            
            <div id="parametersList"></div>
            <button class="btn btn-secondary" id="addParamBtn" style="margin-top: 12px;">+ Add Parameter</button>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 8px; font-weight: 500;">Function Body <span class="required">*</span></div>
            <div class="info-text" style="margin-bottom: 8px;">Write your function code between BEGIN and END</div>
            
            <div class="function-body-editor">
                <div class="code-line readonly">BEGIN</div>
                <textarea id="functionBody" placeholder="    -- Your code here&#10;    RETURN result;"></textarea>
                <div class="code-line readonly">END;</div>
            </div>

            <div class="helper-section">
                <div class="helper-title">Common Patterns:</div>
                <div class="info-text">
                    • Use RETURN to return a value<br>
                    • Declare variables: my_var INTEGER := 0;<br>
                    • Use $1, $2 to reference parameters
                </div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('optionsSection')">
                <span class="toggle-icon" id="optionsIcon">▶</span>
                Advanced Options
            </div>
            <div class="collapsible-content" id="optionsSection">
            <div class="checkbox-group">
                <input type="checkbox" id="isVolatile" checked />
                <label for="isVolatile" style="margin: 0;">VOLATILE</label>
            </div>
            <div class="info-text">Uncheck for STABLE functions (deterministic, no database modifications)</div>

                <div class="checkbox-group" style="margin-top: 12px;">
                <input type="checkbox" id="securityDefiner" />
                <label for="securityDefiner" style="margin: 0;">SECURITY DEFINER</label>
            </div>
            <div class="info-text">Execute with privileges of function owner (use with caution)</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <div class="sql-preview" id="sqlPreview">-- SQL will be generated automatically as you fill in the form</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create Function</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let parameters = [];

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        function addParameter() {
            const id = Date.now();
            parameters.push({ id, name: '', type: '', mode: 'IN', defaultValue: '' });
            renderParameters();
            updatePreview();
        }

        function removeParameter(id) {
            parameters = parameters.filter(p => p.id !== id);
            renderParameters();
            updatePreview();
        }

        function renderParameters() {
            const container = document.getElementById('parametersList');
            if (parameters.length === 0) {
                container.innerHTML = '<div class="info-text">No parameters added yet</div>';
                return;
            }

            container.innerHTML = parameters.map(param => \`
                <div class="parameter-item">
                    <select class="param-mode" data-id="\${param.id}">
                        <option value="IN" \${param.mode === 'IN' ? 'selected' : ''}>IN</option>
                        <option value="OUT" \${param.mode === 'OUT' ? 'selected' : ''}>OUT</option>
                        <option value="INOUT" \${param.mode === 'INOUT' ? 'selected' : ''}>INOUT</option>
                    </select>
                    <input type="text" class="param-name" data-id="\${param.id}" value="\${param.name}" placeholder="param_name" />
                    <select class="param-type" data-id="\${param.id}">
                        <option value="">-- Type --</option>
                        <optgroup label="Numeric">
                            <option value="INTEGER" \${param.type === 'INTEGER' ? 'selected' : ''}>INTEGER</option>
                            <option value="BIGINT" \${param.type === 'BIGINT' ? 'selected' : ''}>BIGINT</option>
                            <option value="NUMERIC" \${param.type === 'NUMERIC' ? 'selected' : ''}>NUMERIC</option>
                            <option value="REAL" \${param.type === 'REAL' ? 'selected' : ''}>REAL</option>
                            <option value="DOUBLE PRECISION" \${param.type === 'DOUBLE PRECISION' ? 'selected' : ''}>DOUBLE PRECISION</option>
                        </optgroup>
                        <optgroup label="Text">
                            <option value="TEXT" \${param.type === 'TEXT' ? 'selected' : ''}>TEXT</option>
                            <option value="VARCHAR" \${param.type === 'VARCHAR' ? 'selected' : ''}>VARCHAR</option>
                            <option value="CHAR" \${param.type === 'CHAR' ? 'selected' : ''}>CHAR</option>
                        </optgroup>
                        <optgroup label="Other">
                            <option value="BOOLEAN" \${param.type === 'BOOLEAN' ? 'selected' : ''}>BOOLEAN</option>
                            <option value="DATE" \${param.type === 'DATE' ? 'selected' : ''}>DATE</option>
                            <option value="TIMESTAMP" \${param.type === 'TIMESTAMP' ? 'selected' : ''}>TIMESTAMP</option>
                            <option value="TIMESTAMPTZ" \${param.type === 'TIMESTAMPTZ' ? 'selected' : ''}>TIMESTAMPTZ</option>
                            <option value="UUID" \${param.type === 'UUID' ? 'selected' : ''}>UUID</option>
                            <option value="JSON" \${param.type === 'JSON' ? 'selected' : ''}>JSON</option>
                            <option value="JSONB" \${param.type === 'JSONB' ? 'selected' : ''}>JSONB</option>
                        </optgroup>
                        <optgroup label="Arrays">
                            <option value="INTEGER[]" \${param.type === 'INTEGER[]' ? 'selected' : ''}>INTEGER[]</option>
                            <option value="TEXT[]" \${param.type === 'TEXT[]' ? 'selected' : ''}>TEXT[]</option>
                        </optgroup>
                    </select>
                    <input type="text" class="param-default" data-id="\${param.id}" value="\${param.defaultValue || ''}" placeholder="Default" />
                    <button class="btn-remove" onclick="removeParameter(\${param.id})">✕</button>
                </div>
            \`).join('');

            // Add event listeners
            document.querySelectorAll('.param-mode, .param-name, .param-type, .param-default').forEach(el => {
                const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
                el.addEventListener(eventType, (e) => {
                    const id = parseInt(e.target.dataset.id);
                    const param = parameters.find(p => p.id === id);
                    if (param) {
                        if (e.target.classList.contains('param-mode')) param.mode = e.target.value;
                        if (e.target.classList.contains('param-name')) param.name = e.target.value;
                        if (e.target.classList.contains('param-type')) param.type = e.target.value;
                        if (e.target.classList.contains('param-default')) param.defaultValue = e.target.value;
                        updatePreview();
                    }
                });
            });
        }

        window.removeParameter = removeParameter;
        window.toggleSection = toggleSection;

        document.getElementById('addParamBtn').addEventListener('click', addParameter);

        // Auto-update preview on input changes
        ['functionName', 'returnType', 'language', 'functionBody', 'replaceIfExists', 'isVolatile', 'securityDefiner'].forEach(id => {
            const element = document.getElementById(id);
            element.addEventListener('input', updatePreview);
            element.addEventListener('change', updatePreview);
        });

        function getFunctionDefinition() {
            return {
                schema: '${schema}',
                functionName: document.getElementById('functionName').value.trim(),
                parameters: parameters,
                returnType: document.getElementById('returnType').value.trim(),
                language: document.getElementById('language').value,
                body: document.getElementById('functionBody').value.trim(),
                isVolatile: document.getElementById('isVolatile').checked,
                securityDefiner: document.getElementById('securityDefiner').checked,
                replaceIfExists: document.getElementById('replaceIfExists').checked
            };
        }

        function updatePreview() {
            const funcName = document.getElementById('functionName').value.trim();
            const returnType = document.getElementById('returnType').value.trim();
            const body = document.getElementById('functionBody').value.trim();
            
            if (funcName && returnType && body) {
                vscode.postMessage({
                    command: 'previewSql',
                    funcDef: getFunctionDefinition()
                });
            } else {
                document.getElementById('sqlPreview').textContent = '-- Fill in all required fields to see the SQL preview';
            }
        }

        function validateFunction() {
            clearError();
            
            const funcName = document.getElementById('functionName').value.trim();
            if (!funcName) {
                showError('Function name is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(funcName)) {
                showError('Function name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }
            
            if (!document.getElementById('returnType').value.trim()) {
                showError('Return type is required');
                return false;
            }
            
            if (!document.getElementById('functionBody').value.trim()) {
                showError('Function body is required');
                return false;
            }
            
            return true;
        }

        document.getElementById('createBtn').addEventListener('click', () => {
            if (!validateFunction()) return;
            vscode.postMessage({
                command: 'createFunction',
                funcDef: getFunctionDefinition()
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

        renderParameters();
        updatePreview();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for edit function panel
     */
    private static getEditFunctionHtml(
        schema: string,
        functionName: string,
        definition: string,
        args: string,
        returnType: string,
        language: string,
        volatility: string,
        securityDefiner: boolean
    ): string {
        // Extract function body from definition
        // PostgreSQL functions can use various dollar-quote delimiters: $$, $function$, $body$, etc.
        // Pattern: AS <whitespace> $<optional_tag>$ <body> $<same_tag>$
        const dollarQuoteMatch = definition.match(/AS\s+\$([a-zA-Z0-9_]*)\$([\s\S]*?)\$\1\$/i);
        let body = dollarQuoteMatch ? dollarQuoteMatch[2].trim() : '';
        
        // Strip BEGIN...END wrapper from body to show only inner content
        const beginEndMatch = body.match(/^\s*BEGIN\s+([\s\S]*?)\s+END;\s*$/i);
        if (beginEndMatch) {
            body = beginEndMatch[1].trim();
        }
        
        // Use JSON.stringify to safely encode the body for JavaScript
        const bodyJson = JSON.stringify(body);
        
        // Debug logging
        console.log('[getEditFunctionHtml] Processing:', {
            definitionPreview: definition.substring(0, 200),
            definitionLength: definition.length,
            dollarQuoteMatchFound: !!dollarQuoteMatch,
            bodyLength: body.length,
            bodyPreview: body.substring(0, 100),
            returnType: returnType,
            language: language
        });
        
        // Normalize return type to uppercase for matching with dropdown options
        const normalizedReturnType = returnType.toUpperCase().trim();
        
        // Parse parameters from args string
        // Format: "param1 type1, param2 type2" or "IN param1 type1, OUT param2 type2"
        const parseParameters = (argsStr: string) => {
            if (!argsStr || argsStr.trim() === '') { return []; }
            
            const params: any[] = [];
            const paramParts = argsStr.split(',').map(p => p.trim());
            
            paramParts.forEach(param => {
                const parts = param.split(/\s+/);
                let mode = 'IN';
                let name = '';
                let type = '';
                
                if (parts[0] && ['IN', 'OUT', 'INOUT'].includes(parts[0].toUpperCase())) {
                    mode = parts[0].toUpperCase();
                    name = parts[1] || '';
                    type = parts.slice(2).join(' ');
                } else {
                    name = parts[0] || '';
                    type = parts.slice(1).join(' ');
                }
                
                if (name && type) {
                    params.push({ mode, name, type, defaultValue: '' });
                }
            });
            
            return params;
        };
        
        const parsedParams = parseParameters(args);
        const paramsJson = JSON.stringify(parsedParams);
        const isVolatile = volatility === 'v';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Function</title>
    ${getStyles()}
    <style>
        /* Function-specific styles */
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
        .parameter-item {
            display: grid;
            grid-template-columns: 80px 1fr 1fr 1fr 40px;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }
        .param-mode, .param-name, .param-type, .param-default {
            padding: 6px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-size: 12px;
            height: 32px;
            box-sizing: border-box;
        }
        /* Styling for disabled/readonly fields */
        .param-mode:disabled, .param-type:disabled,
        .param-name[readonly], .param-default[readonly] {
            background-color: var(--vscode-input-background);
            opacity: 0.6;
            cursor: not-allowed;
            color: var(--vscode-descriptionForeground);
        }
        .btn-remove {
            background-color: var(--vscode-errorForeground);
            color: white;
            border: none;
            border-radius: 3px;
            padding: 0;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            height: 32px;
            width: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .btn-remove:hover {
            opacity: 0.8;
        }
        select.param-type {
            cursor: pointer;
        }
        select.param-type:disabled, select.param-mode:disabled {
            cursor: not-allowed;
        }
        .function-body-editor {
            display: flex;
            flex-direction: column;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
        }
        .function-body-editor .code-line {
            padding: 8px 12px;
            color: var(--vscode-input-foreground);
            background-color: var(--vscode-input-background);
        }
        .function-body-editor .readonly {
            background-color: var(--vscode-editor-inactiveSelectionBackground);
            opacity: 0.7;
            user-select: none;
        }
        .function-body-editor textarea {
            border: none;
            border-top: 1px solid var(--vscode-input-border);
            border-bottom: 1px solid var(--vscode-input-border);
            border-radius: 0;
            min-height: 200px;
            resize: vertical;
            font-family: 'Courier New', Courier, monospace;
            font-size: 13px;
            padding: 8px 12px;
            line-height: 1.5;
        }
        .function-body-editor textarea:focus {
            outline: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit Function</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema</label>
                <input type="text" id="schemaInput" value="${schema}" readonly />
            </div>

            <div class="form-group">
                <label>Function Name <span class="required">*</span></label>
                <input type="text" id="functionName" value="${functionName}" placeholder="my_function" />
                <div class="info-text">Naming convention: lowercase with underscores. Changing the name will create a new function.</div>
            </div>

            <div class="form-group">
                <label>Return Type (Read-only)</label>
                <select id="returnType" disabled>
                    <option value="">-- Select Return Type --</option>
                    <optgroup label="Common Types">
                        <option value="VOID">VOID (No return value)</option>
                        <option value="INTEGER">INTEGER</option>
                        <option value="BIGINT">BIGINT</option>
                        <option value="NUMERIC">NUMERIC</option>
                        <option value="REAL">REAL</option>
                        <option value="DOUBLE PRECISION">DOUBLE PRECISION</option>
                        <option value="TEXT">TEXT</option>
                        <option value="VARCHAR">VARCHAR</option>
                        <option value="CHAR">CHAR</option>
                        <option value="BOOLEAN">BOOLEAN</option>
                        <option value="DATE">DATE</option>
                        <option value="TIME">TIME</option>
                        <option value="TIMESTAMP">TIMESTAMP</option>
                        <option value="TIMESTAMPTZ">TIMESTAMPTZ</option>
                        <option value="UUID">UUID</option>
                        <option value="JSON">JSON</option>
                        <option value="JSONB">JSONB</option>
                    </optgroup>
                    <optgroup label="Array Types">
                        <option value="INTEGER[]">INTEGER[]</option>
                        <option value="TEXT[]">TEXT[]</option>
                        <option value="JSONB[]">JSONB[]</option>
                    </optgroup>
                    <optgroup label="Special">
                        <option value="TRIGGER">TRIGGER (For trigger functions)</option>
                        <option value="RECORD">RECORD</option>
                        <option value="SETOF RECORD">SETOF RECORD</option>
                        <option value="TABLE">TABLE</option>
                    </optgroup>
                </select>
                <div class="info-text">Return type cannot be modified when editing a function. In PostgreSQL, the function signature (name + parameters + return type) uniquely identifies a function, so changing the return type would create a new function instead of editing the existing one. To modify the return type, drop and recreate the function.</div>
            </div>

            <div class="form-group">
                <label>Language</label>
                <select id="language">
                    <option value="plpgsql">PL/pgSQL (Procedural)</option>
                    <option value="sql">SQL</option>
                </select>
                <div class="info-text">PL/pgSQL is recommended for complex functions with variables and control structures. SQL is for simple functions.</div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="replaceIfExists" checked />
                <label for="replaceIfExists" style="margin: 0;">CREATE OR REPLACE</label>
            </div>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 12px; font-weight: 500;">Parameters (Read-only)</div>
            <div class="info-text" style="margin-bottom: 12px; color: var(--vscode-descriptionForeground);">
                Parameters cannot be modified when editing a function. In PostgreSQL, the function signature (name + parameters) uniquely identifies a function, so changing parameters would create a new function instead of editing the existing one. To modify parameters, drop and recreate the function.
            </div>
            
            <div id="parametersList"></div>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 8px; font-weight: 500;">Function Body <span class="required">*</span></div>
            <div class="info-text" style="margin-bottom: 8px;">Write your function code between BEGIN and END</div>
            
            <div class="function-body-editor">
                <div class="code-line readonly">BEGIN</div>
                <textarea id="functionBody" placeholder="    -- Your code here&#10;    RETURN result;"></textarea>
                <div class="code-line readonly">END;</div>
            </div>

            <div class="helper-section">
                <div class="helper-title">Common Patterns:</div>
                <div class="info-text">
                    • Use RETURN to return a value<br>
                    • Declare variables: my_var INTEGER := 0;<br>
                    • Use $1, $2 to reference parameters
                </div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('optionsSection')">
                <span class="toggle-icon" id="optionsIcon">▶</span>
                Advanced Options
            </div>
            <div class="collapsible-content" id="optionsSection">
                <div class="checkbox-group">
                    <input type="checkbox" id="isVolatile" ${isVolatile ? 'checked' : ''} />
                    <label for="isVolatile" style="margin: 0;">VOLATILE</label>
                </div>
                <div class="info-text">Uncheck for STABLE functions (deterministic, no database modifications)</div>

                <div class="checkbox-group" style="margin-top: 12px;">
                    <input type="checkbox" id="securityDefiner" ${securityDefiner ? 'checked' : ''} />
                    <label for="securityDefiner" style="margin: 0;">SECURITY DEFINER</label>
                </div>
                <div class="info-text">Execute with privileges of function owner (use with caution)</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreviewSection')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span>
                SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewSection">
                <div class="sql-preview" id="sqlPreview">-- SQL will be generated automatically as you fill in the form</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="updateBtn">Update Function</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let parameters = ${paramsJson};

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        function addParameter() {
            const id = Date.now();
            parameters.push({ id, name: '', type: '', mode: 'IN', defaultValue: '' });
            renderParameters();
            updatePreview();
        }

        function removeParameter(id) {
            parameters = parameters.filter(p => p.id !== id);
            renderParameters();
            updatePreview();
        }

        function renderParameters() {
            const container = document.getElementById('parametersList');
            if (parameters.length === 0) {
                container.innerHTML = '<div class="info-text">No parameters defined</div>';
                return;
            }

            container.innerHTML = parameters.map(param => \`
                <div class="parameter-item">
                    <select class="param-mode" data-id="\${param.id}" disabled>
                        <option value="IN" \${param.mode === 'IN' ? 'selected' : ''}>IN</option>
                        <option value="OUT" \${param.mode === 'OUT' ? 'selected' : ''}>OUT</option>
                        <option value="INOUT" \${param.mode === 'INOUT' ? 'selected' : ''}>INOUT</option>
                    </select>
                    <input type="text" class="param-name" placeholder="param_name" data-id="\${param.id}" value="\${param.name}" readonly />
                    <select class="param-type" data-id="\${param.id}" disabled>
                        <option value="">-- Select Type --</option>
                        <optgroup label="Numeric">
                            <option value="INTEGER" \${param.type === 'INTEGER' ? 'selected' : ''}>INTEGER</option>
                            <option value="BIGINT" \${param.type === 'BIGINT' ? 'selected' : ''}>BIGINT</option>
                            <option value="NUMERIC" \${param.type === 'NUMERIC' ? 'selected' : ''}>NUMERIC</option>
                            <option value="REAL" \${param.type === 'REAL' ? 'selected' : ''}>REAL</option>
                            <option value="DOUBLE PRECISION" \${param.type === 'DOUBLE PRECISION' ? 'selected' : ''}>DOUBLE PRECISION</option>
                        </optgroup>
                        <optgroup label="Text">
                            <option value="TEXT" \${param.type === 'TEXT' ? 'selected' : ''}>TEXT</option>
                            <option value="VARCHAR" \${param.type === 'VARCHAR' ? 'selected' : ''}>VARCHAR</option>
                            <option value="CHAR" \${param.type === 'CHAR' ? 'selected' : ''}>CHAR</option>
                        </optgroup>
                        <optgroup label="Other">
                            <option value="BOOLEAN" \${param.type === 'BOOLEAN' ? 'selected' : ''}>BOOLEAN</option>
                            <option value="DATE" \${param.type === 'DATE' ? 'selected' : ''}>DATE</option>
                            <option value="TIMESTAMP" \${param.type === 'TIMESTAMP' ? 'selected' : ''}>TIMESTAMP</option>
                            <option value="TIMESTAMPTZ" \${param.type === 'TIMESTAMPTZ' ? 'selected' : ''}>TIMESTAMPTZ</option>
                            <option value="UUID" \${param.type === 'UUID' ? 'selected' : ''}>UUID</option>
                            <option value="JSON" \${param.type === 'JSON' ? 'selected' : ''}>JSON</option>
                            <option value="JSONB" \${param.type === 'JSONB' ? 'selected' : ''}>JSONB</option>
                        </optgroup>
                        <optgroup label="Arrays">
                            <option value="INTEGER[]" \${param.type === 'INTEGER[]' ? 'selected' : ''}>INTEGER[]</option>
                            <option value="TEXT[]" \${param.type === 'TEXT[]' ? 'selected' : ''}>TEXT[]</option>
                            <option value="JSONB[]" \${param.type === 'JSONB[]' ? 'selected' : ''}>JSONB[]</option>
                        </optgroup>
                    </select>
                    <input type="text" class="param-default" placeholder="default" data-id="\${param.id}" value="\${param.defaultValue || ''}" readonly />
                    <div style="width: 32px;"></div>
                </div>
            \`).join('');

            // Note: No event listeners needed since parameters are read-only in edit mode
        }

        window.removeParameter = removeParameter;

        function getFunctionDefinition() {
            return {
                schema: document.getElementById('schemaInput').value.trim(),
                functionName: document.getElementById('functionName').value.trim(),
                parameters: parameters.map(p => ({
                    mode: p.mode,
                    name: p.name,
                    type: p.type,
                    defaultValue: p.defaultValue
                })),
                returnType: document.getElementById('returnType').value,
                language: document.getElementById('language').value,
                body: document.getElementById('functionBody').value.trim(),
                isVolatile: document.getElementById('isVolatile').checked,
                securityDefiner: document.getElementById('securityDefiner').checked,
                replaceIfExists: document.getElementById('replaceIfExists').checked
            };
        }

        function updatePreview() {
            const funcDef = getFunctionDefinition();
            vscode.postMessage({ command: 'previewSql', funcDef });
        }

        // Elements
        const functionNameInput = document.getElementById('functionName');
        const returnTypeInput = document.getElementById('returnType');
        const languageInput = document.getElementById('language');
        const functionBodyInput = document.getElementById('functionBody');
        const isVolatileCheckbox = document.getElementById('isVolatile');
        const securityDefinerCheckbox = document.getElementById('securityDefiner');
        const replaceIfExistsCheckbox = document.getElementById('replaceIfExists');
        // Note: addParamBtn removed - parameters cannot be edited in edit mode
        const updateBtn = document.getElementById('updateBtn');
        const cancelBtn = document.getElementById('cancelBtn');

        // Event listeners
        functionNameInput.addEventListener('input', updatePreview);
        returnTypeInput.addEventListener('change', updatePreview);
        languageInput.addEventListener('change', updatePreview);
        functionBodyInput.addEventListener('input', updatePreview);
        isVolatileCheckbox.addEventListener('change', updatePreview);
        securityDefinerCheckbox.addEventListener('change', updatePreview);
        replaceIfExistsCheckbox.addEventListener('change', updatePreview);
        // Note: addParamBtn removed - parameters cannot be edited

        updateBtn.addEventListener('click', () => {
            const funcDef = getFunctionDefinition();
            
            if (!funcDef.functionName) {
                showError('Function name is required');
                return;
            }
            if (!funcDef.returnType) {
                showError('Return type is required');
                return;
            }
            if (!funcDef.body) {
                showError('Function body cannot be empty');
                return;
            }

            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating...';

            vscode.postMessage({
                command: 'updateFunction',
                funcDef: funcDef
            });
        });

        cancelBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'error':
                    showError(message.error);
                    updateBtn.disabled = false;
                    updateBtn.textContent = 'Update Function';
                    break;
                case 'sqlPreview':
                    document.getElementById('sqlPreview').textContent = message.sql;
                    break;
            }
        });

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Set initial function body from JSON-encoded value
        const initialBody = ${bodyJson};
        document.getElementById('functionBody').value = initialBody;

        // Debug: Log initial values
        console.log('[Edit Function] Initial values:', {
            returnType: '${normalizedReturnType}',
            language: '${language}',
            bodyLength: initialBody.length,
            bodyPreview: initialBody.substring(0, 100),
            parameters: parameters
        });

        // Set initial return type (normalized to uppercase)
        const returnTypeSelect = document.getElementById('returnType');
        returnTypeSelect.value = '${normalizedReturnType}';
        console.log('[Edit Function] Return type set to:', returnTypeSelect.value, 'Selected:', returnTypeSelect.value === '${normalizedReturnType}');
        
        // Set initial language
        document.getElementById('language').value = '${language}';

        // Initial render
        renderParameters();
        updatePreview();
    </script>
</body>
</html>`;
    }
}
