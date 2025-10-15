import * as vscode from 'vscode';
import { StateService } from './services/state.service';
import { SqlQueryService } from './services/sqlQuery.service';
import { getStyles } from './templates/styles';

export class PolicyManagementPanel {
    private static currentPanels: Map<string, vscode.WebviewPanel> = new Map();

    /**
     * Create a new RLS policy
     */
    public static async createPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        const key = `create_policy_${database || 'default'}.${schema}.${tableName}`;
        
        if (PolicyManagementPanel.currentPanels.has(key)) {
            PolicyManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createPolicy',
            `Create Policy: ${schema}.${tableName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        PolicyManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            PolicyManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get available roles (exclude PostgreSQL and Neon system roles)
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname 
                FROM pg_roles 
                WHERE rolname NOT LIKE 'pg_%'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                ORDER BY rolname
            `, [], database);

            // Get table columns for expression suggestions
            const columnsResult = await sqlService.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, tableName], database);

            panel.webview.html = PolicyManagementPanel.getCreatePolicyHtml(
                schema,
                tableName,
                rolesResult.rows,
                columnsResult.rows
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createPolicy':
                        await PolicyManagementPanel.executeCreatePolicy(
                            context,
                            stateService,
                            schema,
                            tableName,
                            message.policyDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = PolicyManagementPanel.generateCreatePolicySql(
                            schema,
                            tableName,
                            message.policyDef
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
            vscode.window.showErrorMessage(`Failed to load policy creation form: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Edit an existing policy
     */
    public static async editPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        policyName: string,
        database?: string
    ): Promise<void> {
        const key = `edit_policy_${database || 'default'}.${schema}.${tableName}.${policyName}`;
        
        if (PolicyManagementPanel.currentPanels.has(key)) {
            PolicyManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'editPolicy',
            `Edit Policy: ${policyName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        PolicyManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            PolicyManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get current policy information
            const policyResult = await sqlService.executeQuery(`
                SELECT 
                    pol.polname as policy_name,
                    pol.polpermissive as is_permissive,
                    pol.polcmd as command,
                    ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) as roles,
                    pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
                    pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expression
                FROM pg_policy pol
                JOIN pg_class c ON pol.polrelid = c.oid
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE pol.polname = $1
                    AND c.relname = $2
                    AND n.nspname = $3
            `, [policyName, tableName, schema], database);

            if (policyResult.rows.length === 0) {
                vscode.window.showWarningMessage(`Policy "${policyName}" not found.`);
                panel.dispose();
                return;
            }

            const policyInfo = policyResult.rows[0];

            // Get available roles (exclude PostgreSQL and Neon system roles)
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname 
                FROM pg_roles 
                WHERE rolname NOT LIKE 'pg_%'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                ORDER BY rolname
            `, [], database);

            // Get table columns
            const columnsResult = await sqlService.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, tableName], database);

            panel.webview.html = PolicyManagementPanel.getEditPolicyHtml(
                schema,
                tableName,
                policyName,
                policyInfo,
                rolesResult.rows,
                columnsResult.rows
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'editPolicy':
                        await PolicyManagementPanel.executeEditPolicy(
                            context,
                            stateService,
                            schema,
                            tableName,
                            policyName,
                            message.policyDef,
                            database,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = PolicyManagementPanel.generateEditPolicySql(
                            schema,
                            tableName,
                            policyName,
                            message.policyDef
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
            vscode.window.showErrorMessage(`Failed to load policy: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop a policy
     */
    public static async dropPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        policyName: string,
        database?: string
    ): Promise<void> {
        try {
            const sql = `DROP POLICY IF EXISTS "${policyName}" ON "${schema}"."${tableName}";`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Policy "${policyName}" dropped successfully!`);
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
            vscode.window.showErrorMessage(`Failed to drop policy: ${errorMessage}`);
        }
    }

    /**
     * Execute create policy
     */
    private static async executeCreatePolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        policyDef: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = PolicyManagementPanel.generateCreatePolicySql(schema, tableName, policyDef);
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Policy "${policyDef.name}" created successfully!`);
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
     * Execute edit policy
     */
    private static async executeEditPolicy(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        tableName: string,
        oldPolicyName: string,
        policyDef: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = PolicyManagementPanel.generateEditPolicySql(schema, tableName, oldPolicyName, policyDef);
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Policy "${policyDef.name}" updated successfully!`);
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
     * Generate CREATE POLICY SQL
     */
    private static generateCreatePolicySql(schema: string, tableName: string, policyDef: any): string {
        const {
            name,
            type,
            command,
            roles,
            usingExpression,
            withCheckExpression
        } = policyDef;

        let sql = `CREATE POLICY "${name}" ON "${schema}"."${tableName}"\n`;
        sql += `  AS ${type}\n`;
        sql += `  FOR ${command}\n`;
        
        if (roles && roles.length > 0) {
            sql += `  TO ${roles.map((r: string) => r === 'PUBLIC' ? r : `"${r}"`).join(', ')}\n`;
        }
        
        if (usingExpression && usingExpression.trim()) {
            sql += `  USING (${usingExpression})\n`;
        }
        
        if (withCheckExpression && withCheckExpression.trim()) {
            sql += `  WITH CHECK (${withCheckExpression})\n`;
        }
        
        sql += ';';
        return sql;
    }

    /**
     * Generate EDIT POLICY SQL (DROP + CREATE)
     */
    private static generateEditPolicySql(schema: string, tableName: string, oldPolicyName: string, policyDef: any): string {
        // Drop the old policy
        let sql = `DROP POLICY IF EXISTS "${oldPolicyName}" ON "${schema}"."${tableName}";\n\n`;
        
        // Create the new policy
        sql += PolicyManagementPanel.generateCreatePolicySql(schema, tableName, policyDef);
        
        return sql;
    }

    /**
     * Get HTML for create policy panel
     */
    private static getCreatePolicyHtml(
        schema: string,
        tableName: string,
        roles: any[],
        columns: any[]
    ): string {
        const rolesJson = JSON.stringify(roles);
        const columnsJson = JSON.stringify(columns);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Policy</title>
    ${getStyles()}
    <style>
        .role-selector {
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            max-height: 150px;
            overflow-y: auto;
            background-color: var(--vscode-input-background);
        }
        .role-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px;
            cursor: pointer;
        }
        .role-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create RLS Policy on ${schema}.${tableName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Policy Name <span class="required">*</span></label>
                <input type="text" id="policyName" placeholder="policy_name" />
                <div class="info-text">Name of the row-level security policy</div>
            </div>

            <div class="form-group">
                <label>Policy Type <span class="required">*</span></label>
                <select id="policyType">
                    <option value="PERMISSIVE">PERMISSIVE (Allow matching rows)</option>
                    <option value="RESTRICTIVE">RESTRICTIVE (Deny non-matching rows)</option>
                </select>
                <div class="info-text">PERMISSIVE allows rows that match, RESTRICTIVE denies rows that don't match</div>
            </div>

            <div class="form-group">
                <label>Command <span class="required">*</span></label>
                <select id="command">
                    <option value="ALL">ALL - All operations</option>
                    <option value="SELECT">SELECT - Read access</option>
                    <option value="INSERT">INSERT - Create access</option>
                    <option value="UPDATE">UPDATE - Modify access</option>
                    <option value="DELETE">DELETE - Remove access</option>
                </select>
                <div class="info-text">Which database operations this policy applies to</div>
            </div>

            <div class="form-group">
                <label>Roles</label>
                <div class="info-text" style="margin-bottom: 8px;">Select roles this policy applies to (leave empty for all roles)</div>
                <div class="role-selector" id="roleSelector"></div>
            </div>

            <div class="form-group">
                <label>USING Expression</label>
                <textarea id="usingExpression" rows="4" placeholder="e.g., user_id = current_user_id()"></textarea>
                <div class="info-text">Boolean expression to determine which rows are visible/modifiable</div>
            </div>

            <div class="form-group">
                <label>WITH CHECK Expression (Optional)</label>
                <textarea id="withCheckExpression" rows="4" placeholder="e.g., status = 'active'"></textarea>
                <div class="info-text">For INSERT/UPDATE: boolean expression to check new rows (defaults to USING expression)</div>
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
            <button class="btn" id="createBtn">Create Policy</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const roles = ${rolesJson};
        const columns = ${columnsJson};
        let selectedRoles = [];

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        const policyNameInput = document.getElementById('policyName');
        const policyTypeSelect = document.getElementById('policyType');
        const commandSelect = document.getElementById('command');
        const roleSelector = document.getElementById('roleSelector');
        const usingExpressionInput = document.getElementById('usingExpression');
        const withCheckExpressionInput = document.getElementById('withCheckExpression');
        const createBtn = document.getElementById('createBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        // Render role checkboxes
        roles.forEach(role => {
            const div = document.createElement('div');
            div.className = 'role-item';
            div.innerHTML = \`
                <input type="checkbox" id="role_\${role.rolname}" value="\${role.rolname}" />
                <label for="role_\${role.rolname}" style="cursor: pointer; margin: 0;">\${role.rolname}</label>
            \`;
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = div.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            div.querySelector('input').addEventListener('change', () => {
                selectedRoles = Array.from(roleSelector.querySelectorAll('input:checked')).map(cb => cb.value);
                updatePreview();
            });
            roleSelector.appendChild(div);
        });

        function getPolicyDefinition() {
            return {
                name: policyNameInput.value.trim(),
                type: policyTypeSelect.value,
                command: commandSelect.value,
                roles: selectedRoles,
                usingExpression: usingExpressionInput.value.trim(),
                withCheckExpression: withCheckExpressionInput.value.trim()
            };
        }

        function validatePolicy(showErrors = true) {
            if (showErrors) {
                clearError();
            }

            if (!policyNameInput.value.trim()) {
                if (showErrors) showError('Policy name is required');
                return false;
            }

            if (!/^[a-z_][a-z0-9_]*$/i.test(policyNameInput.value.trim())) {
                if (showErrors) showError('Policy name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }

            return true;
        }

        function updatePreview() {
            if (!validatePolicy(false)) {
                document.getElementById('sqlPreview').textContent = '-- Fill in required fields to generate SQL preview';
                return;
            }
            vscode.postMessage({
                command: 'previewSql',
                policyDef: getPolicyDefinition()
            });
        }

        // Auto-update preview
        policyNameInput.addEventListener('input', updatePreview);
        policyTypeSelect.addEventListener('change', updatePreview);
        commandSelect.addEventListener('change', updatePreview);
        usingExpressionInput.addEventListener('input', updatePreview);
        withCheckExpressionInput.addEventListener('input', updatePreview);

        createBtn.addEventListener('click', () => {
            if (!validatePolicy(true)) return;
            vscode.postMessage({
                command: 'createPolicy',
                policyDef: getPolicyDefinition()
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

    /**
     * Get HTML for edit policy panel
     */
    private static getEditPolicyHtml(
        schema: string,
        tableName: string,
        policyName: string,
        policyInfo: any,
        roles: any[],
        columns: any[]
    ): string {
        const rolesJson = JSON.stringify(roles);
        const columnsJson = JSON.stringify(columns);
        
        // Parse command from pg_policy format
        let commandValue = 'ALL';
        switch (policyInfo.command) {
            case '*': commandValue = 'ALL'; break;
            case 'r': commandValue = 'SELECT'; break;
            case 'a': commandValue = 'INSERT'; break;
            case 'w': commandValue = 'UPDATE'; break;
            case 'd': commandValue = 'DELETE'; break;
        }
        
        const policyRoles = policyInfo.roles || [];
        const selectedRolesJson = JSON.stringify(policyRoles);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Policy</title>
    ${getStyles()}
    <style>
        .role-selector {
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
            padding: 8px;
            max-height: 150px;
            overflow-y: auto;
            background-color: var(--vscode-input-background);
        }
        .role-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px;
            cursor: pointer;
        }
        .role-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit Policy</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Policy Name <span class="required">*</span></label>
                <input type="text" id="policyName" value="${policyName}" />
                <div class="info-text">Rename policy by changing the name</div>
            </div>

            <div class="form-group">
                <label>Policy Type <span class="required">*</span></label>
                <select id="policyType">
                    <option value="PERMISSIVE" ${policyInfo.is_permissive ? 'selected' : ''}>PERMISSIVE (Allow matching rows)</option>
                    <option value="RESTRICTIVE" ${!policyInfo.is_permissive ? 'selected' : ''}>RESTRICTIVE (Deny non-matching rows)</option>
                </select>
                <div class="info-text">PERMISSIVE allows rows that match, RESTRICTIVE denies rows that don't match</div>
            </div>

            <div class="form-group">
                <label>Command <span class="required">*</span></label>
                <select id="command">
                    <option value="ALL" ${commandValue === 'ALL' ? 'selected' : ''}>ALL - All operations</option>
                    <option value="SELECT" ${commandValue === 'SELECT' ? 'selected' : ''}>SELECT - Read access</option>
                    <option value="INSERT" ${commandValue === 'INSERT' ? 'selected' : ''}>INSERT - Create access</option>
                    <option value="UPDATE" ${commandValue === 'UPDATE' ? 'selected' : ''}>UPDATE - Modify access</option>
                    <option value="DELETE" ${commandValue === 'DELETE' ? 'selected' : ''}>DELETE - Remove access</option>
                </select>
                <div class="info-text">Which database operations this policy applies to</div>
            </div>

            <div class="form-group">
                <label>Roles</label>
                <div class="info-text" style="margin-bottom: 8px;">Select roles this policy applies to (leave empty for all roles)</div>
                <div class="role-selector" id="roleSelector"></div>
            </div>

            <div class="form-group">
                <label>USING Expression</label>
                <textarea id="usingExpression" rows="4" placeholder="e.g., user_id = current_user_id()">${policyInfo.using_expression || ''}</textarea>
                <div class="info-text">Boolean expression to determine which rows are visible/modifiable</div>
            </div>

            <div class="form-group">
                <label>WITH CHECK Expression (Optional)</label>
                <textarea id="withCheckExpression" rows="4" placeholder="e.g., status = 'active'">${policyInfo.with_check_expression || ''}</textarea>
                <div class="info-text">For INSERT/UPDATE: boolean expression to check new rows (defaults to USING expression)</div>
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
        const roles = ${rolesJson};
        const columns = ${columnsJson};
        const initialRoles = ${selectedRolesJson};
        let selectedRoles = [...initialRoles];

        function toggleSection(sectionId) {
            const section = document.getElementById(sectionId);
            const icon = document.getElementById(sectionId.replace('Section', 'Icon'));
            const isExpanded = section.style.display === 'block';
            section.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        window.toggleSection = toggleSection;

        const policyNameInput = document.getElementById('policyName');
        const policyTypeSelect = document.getElementById('policyType');
        const commandSelect = document.getElementById('command');
        const roleSelector = document.getElementById('roleSelector');
        const usingExpressionInput = document.getElementById('usingExpression');
        const withCheckExpressionInput = document.getElementById('withCheckExpression');
        const saveBtn = document.getElementById('saveBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        // Render role checkboxes
        roles.forEach(role => {
            const div = document.createElement('div');
            div.className = 'role-item';
            const isChecked = initialRoles.includes(role.rolname);
            div.innerHTML = \`
                <input type="checkbox" id="role_\${role.rolname}" value="\${role.rolname}" \${isChecked ? 'checked' : ''} />
                <label for="role_\${role.rolname}" style="cursor: pointer; margin: 0;">\${role.rolname}</label>
            \`;
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const checkbox = div.querySelector('input');
                    checkbox.checked = !checkbox.checked;
                    checkbox.dispatchEvent(new Event('change'));
                }
            });
            div.querySelector('input').addEventListener('change', () => {
                selectedRoles = Array.from(roleSelector.querySelectorAll('input:checked')).map(cb => cb.value);
                updatePreview();
            });
            roleSelector.appendChild(div);
        });

        function getPolicyDefinition() {
            return {
                name: policyNameInput.value.trim(),
                type: policyTypeSelect.value,
                command: commandSelect.value,
                roles: selectedRoles,
                usingExpression: usingExpressionInput.value.trim(),
                withCheckExpression: withCheckExpressionInput.value.trim()
            };
        }

        function validatePolicy(showErrors = true) {
            if (showErrors) {
                clearError();
            }

            if (!policyNameInput.value.trim()) {
                if (showErrors) showError('Policy name is required');
                return false;
            }

            if (!/^[a-z_][a-z0-9_]*$/i.test(policyNameInput.value.trim())) {
                if (showErrors) showError('Policy name must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }

            return true;
        }

        function updatePreview() {
            if (!validatePolicy(false)) {
                document.getElementById('sqlPreview').textContent = '-- Fill in required fields to generate SQL preview';
                return;
            }
            vscode.postMessage({
                command: 'previewSql',
                policyDef: getPolicyDefinition()
            });
        }

        // Auto-update preview
        policyNameInput.addEventListener('input', updatePreview);
        policyTypeSelect.addEventListener('change', updatePreview);
        commandSelect.addEventListener('change', updatePreview);
        usingExpressionInput.addEventListener('input', updatePreview);
        withCheckExpressionInput.addEventListener('input', updatePreview);

        saveBtn.addEventListener('click', () => {
            if (!validatePolicy(true)) return;
            vscode.postMessage({
                command: 'editPolicy',
                policyDef: getPolicyDefinition()
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

