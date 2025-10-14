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
            
            panel.webview.html = FunctionManagementPanel.getEditFunctionHtml(
                schema,
                functionName,
                funcData.definition,
                funcData.arguments,
                funcData.return_type,
                funcData.language
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
     * View function properties
     */
    public static async viewFunctionProperties(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        functionName: string,
        database?: string
    ): Promise<void> {
        const key = `props_func_${database || 'default'}.${schema}.${functionName}`;
        
        if (FunctionManagementPanel.currentPanels.has(key)) {
            FunctionManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'functionProperties',
            `Function Properties: ${schema}.${functionName}`,
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
            
            // Get function details
            const result = await sqlService.executeQuery(`
                SELECT 
                    p.proname as name,
                    pg_get_functiondef(p.oid) as definition,
                    pg_get_function_arguments(p.oid) as arguments,
                    pg_get_function_result(p.oid) as return_type,
                    pg_get_function_identity_arguments(p.oid) as identity_arguments,
                    l.lanname as language,
                    CASE p.provolatile
                        WHEN 'i' THEN 'IMMUTABLE'
                        WHEN 's' THEN 'STABLE'
                        WHEN 'v' THEN 'VOLATILE'
                    END as volatility,
                    p.prosecdef as security_definer,
                    p.proisstrict as strict,
                    p.procost as cost,
                    p.prorows as estimated_rows,
                    obj_description(p.oid, 'pg_proc') as description
                FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                JOIN pg_language l ON p.prolang = l.oid
                WHERE n.nspname = $1 AND p.proname = $2
                LIMIT 1
            `, [schema, functionName], database);

            if (result.rows.length === 0) {
                throw new Error('Function not found');
            }

            panel.webview.html = FunctionManagementPanel.getFunctionPropertiesHtml(
                schema,
                functionName,
                result.rows[0]
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                if (message.command === 'cancel') {
                    panel.dispose();
                }
            });

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load function properties: ${error}`);
            panel.dispose();
        }
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
            const sql = `DROP FUNCTION ${schema}.${functionName}${cascadeStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Function "${functionName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
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
            const errorMessage = error instanceof Error ? error.message : String(error);
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
        sql += body;
        if (!body.trim().endsWith(';')) {
            sql += '\n';
        }
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
                        <option value="RECORD">RECORD</option>
                        <option value="SETOF RECORD">SETOF RECORD</option>
                        <option value="TABLE">TABLE</option>
                    </optgroup>
                </select>
                <div class="info-text">Use VOID for procedures that don't return values</div>
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
            <div style="margin-bottom: 12px; font-weight: 500;">Parameters (optional)</div>
            <div class="info-text" style="margin-bottom: 12px;">Add input/output parameters for your function</div>
            
            <div id="parametersList"></div>
            <button class="btn btn-secondary" id="addParamBtn" style="margin-top: 12px;">+ Add Parameter</button>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 8px; font-weight: 500;">Function Body <span class="required">*</span></div>
            <div class="info-text" style="margin-bottom: 8px;">Write your function code (do not include CREATE FUNCTION or $$)</div>
            
            <textarea id="functionBody" placeholder="BEGIN&#10;    -- Your code here&#10;    RETURN result;&#10;END;"></textarea>

            <div class="helper-section">
                <div class="helper-title">Common Patterns:</div>
                <div class="info-text">
                    • PL/pgSQL: BEGIN...END; with RETURN<br>
                    • SQL: Direct SELECT statement<br>
                    • Use $1, $2 for parameter references in SQL functions
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
                    <input type="text" class="param-default" data-id="\${param.id}" value="\${param.defaultValue || ''}" placeholder="Default (optional)" />
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
        language: string
    ): string {
        // Extract function body from definition
        const bodyMatch = definition.match(/AS\s+\$\$\s*([\s\S]*?)\s*\$\$/i);
        const body = bodyMatch ? bodyMatch[1].trim() : '';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Function</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Edit Function: ${functionName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div style="margin-bottom: 8px; font-weight: 500;">Function: ${schema}.${functionName}</div>
            <div class="info-text">Arguments: ${args || 'none'}</div>
            <div class="info-text">Returns: ${returnType}</div>
            <div class="info-text">Language: ${language}</div>
        </div>

        <div class="section-box">
            <div style="margin-bottom: 8px; font-weight: 500;">Function Body</div>
            <textarea id="functionBody">${body}</textarea>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('definitionSection')">
                <span class="toggle-icon" id="definitionIcon">▶</span>
                Current Definition
            </div>
            <div class="collapsible-content" id="definitionSection">
                <div class="sql-preview">${definition}</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="updateBtn">Update Function</button>
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

        document.getElementById('updateBtn').addEventListener('click', () => {
            const body = document.getElementById('functionBody').value.trim();
            if (!body) {
                showError('Function body cannot be empty');
                return;
            }

            vscode.postMessage({
                command: 'updateFunction',
                funcDef: {
                    schema: '${schema}',
                    functionName: '${functionName}',
                    parameters: [],
                    returnType: '${returnType}',
                    language: '${language}',
                    body: body,
                    isVolatile: true,
                    securityDefiner: false,
                    replaceIfExists: true
                }
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'error') {
                showError(message.error);
            }
        });

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
        }
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for function properties panel
     */
    private static getFunctionPropertiesHtml(
        schema: string,
        functionName: string,
        funcData: any
    ): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Function Properties</title>
    ${getStyles()}
    <style>
        .property-grid {
            display: grid;
            grid-template-columns: 200px 1fr;
            gap: 12px;
            margin-bottom: 20px;
        }
        .property-label {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
        }
        .property-value {
            font-family: monospace;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Function Properties: ${functionName}</h1>
        
        <div class="section-box">
            <div style="margin-bottom: 12px; font-weight: 500;">General Information</div>
            <div class="property-grid">
                <div class="property-label">Schema:</div>
                <div class="property-value">${schema}</div>
                
                <div class="property-label">Function Name:</div>
                <div class="property-value">${functionName}</div>
                
                <div class="property-label">Arguments:</div>
                <div class="property-value">${funcData.arguments || 'none'}</div>
                
                <div class="property-label">Return Type:</div>
                <div class="property-value">${funcData.return_type}</div>
                
                <div class="property-label">Language:</div>
                <div class="property-value">${funcData.language}</div>
                
                <div class="property-label">Volatility:</div>
                <div class="property-value">${funcData.volatility}</div>
                
                <div class="property-label">Security:</div>
                <div class="property-value">${funcData.security_definer ? 'DEFINER' : 'INVOKER'}</div>
                
                <div class="property-label">Strict:</div>
                <div class="property-value">${funcData.strict ? 'Yes' : 'No'}</div>
                
                <div class="property-label">Cost:</div>
                <div class="property-value">${funcData.cost}</div>
                
                <div class="property-label">Description:</div>
                <div class="property-value">${funcData.description || 'No description'}</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('definitionSection')">
                <span class="toggle-icon" id="definitionIcon">▶</span>
                Function Definition
            </div>
            <div class="collapsible-content" id="definitionSection">
                <div class="sql-preview">${funcData.definition}</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn btn-secondary" id="closeBtn">Close</button>
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

        document.getElementById('closeBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });
    </script>
</body>
</html>`;
    }

}


