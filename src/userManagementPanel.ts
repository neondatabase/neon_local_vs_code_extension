import * as vscode from 'vscode';
import { SqlQueryService } from './services/sqlQuery.service';
import { StateService } from './services/state.service';
import { getStyles } from './templates/styles';
import { NeonApiService } from './services/api.service';

export interface UserDefinition {
    roleType?: 'neon' | 'sql';
    username: string;
    password?: string;
    canLogin: boolean;
    isSuperuser: boolean;
    canCreateDb: boolean;
    canCreateRole: boolean;
    connectionLimit: number;
    validUntil?: string;
}

export interface PermissionGrant {
    schema: string;
    objectType: 'table' | 'schema' | 'database' | 'sequence' | 'function';
    objectName: string;
    privileges: string[];
    grantOption: boolean;
    applyToFuture?: boolean;
}

export class UserManagementPanel {
    public static currentPanels = new Map<string, vscode.WebviewPanel>();

    /**
     * Show users list and management interface
     */
    public static async showUsers(
        context: vscode.ExtensionContext,
        stateService: StateService,
        database?: string
    ): Promise<void> {
        const key = `users_${database || 'default'}`;
        
        if (UserManagementPanel.currentPanels.has(key)) {
            UserManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'userManagement',
            'User & Role Management',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        UserManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            UserManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get all users/roles - users are global, so use 'postgres' database if no database specified
            const targetDb = database || 'postgres';
            const usersResult = await sqlService.executeQuery(`
                SELECT 
                    rolname as username,
                    rolsuper as is_superuser,
                    rolinherit as can_inherit,
                    rolcreaterole as can_create_role,
                    rolcreatedb as can_create_db,
                    rolcanlogin as can_login,
                    rolreplication as can_replicate,
                    rolconnlimit as connection_limit,
                    rolvaliduntil as valid_until,
                    ARRAY(
                        SELECT b.rolname
                        FROM pg_catalog.pg_auth_members m
                        JOIN pg_catalog.pg_roles b ON (m.roleid = b.oid)
                        WHERE m.member = r.oid
                    ) as member_of
                FROM pg_catalog.pg_roles r
                WHERE rolname !~ '^pg_'
                ORDER BY rolname
            `, targetDb);

            panel.webview.html = UserManagementPanel.getUsersListHtml(usersResult.rows);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'refresh':
                        const refreshResult = await sqlService.executeQuery(`
                            SELECT 
                                rolname as username,
                                rolsuper as is_superuser,
                                rolinherit as can_inherit,
                                rolcreaterole as can_create_role,
                                rolcreatedb as can_create_db,
                                rolcanlogin as can_login,
                                rolreplication as can_replicate,
                                rolconnlimit as connection_limit,
                                rolvaliduntil as valid_until,
                                ARRAY(
                                    SELECT b.rolname
                                    FROM pg_catalog.pg_auth_members m
                                    JOIN pg_catalog.pg_roles b ON (m.roleid = b.oid)
                                    WHERE m.member = r.oid
                                ) as member_of
                            FROM pg_catalog.pg_roles r
                            WHERE rolname !~ '^pg_'
                            ORDER BY rolname
                        `, targetDb);
                        panel.webview.postMessage({
                            command: 'updateUsers',
                            users: refreshResult.rows
                        });
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                const err = error as any;
                errorMessage = err.message || JSON.stringify(error, null, 2);
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to load users: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Create a new user/role
     */
    public static async createUser(
        context: vscode.ExtensionContext,
        stateService: StateService,
        database?: string
    ): Promise<void> {
        const key = `create_user_${database || 'default'}`;
        
        if (UserManagementPanel.currentPanels.has(key)) {
            UserManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createUser',
            'Create Role',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        UserManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            UserManagementPanel.currentPanels.delete(key);
        });

        try {
            // Get existing roles for membership - users are global, so use 'postgres' database if no database specified
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = database || 'postgres';
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname
                FROM pg_catalog.pg_roles
                WHERE rolname !~ '^pg_'
                  AND rolname NOT IN ('cloud_admin')
                ORDER BY rolname
            `, targetDb);

            panel.webview.html = UserManagementPanel.getCreateUserHtml(
                rolesResult.rows.map(r => r.rolname)
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'createUser':
                        await UserManagementPanel.executeCreateUser(
                            context,
                            stateService,
                            message.userDef,
                            targetDb,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = UserManagementPanel.generateCreateUserSql(message.userDef);
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
                // Handle plain objects
                const err = error as any;
                if (err.message) {
                    errorMessage = err.message;
                } else {
                    errorMessage = JSON.stringify(error, null, 2);
                }
            } else {
                errorMessage = String(error);
            }
            
            console.error('Failed to load roles:', error);
            vscode.window.showErrorMessage(`Failed to load roles: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Manage permissions for a user
     */
    public static async managePermissions(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        database?: string
    ): Promise<void> {
        const key = `perms_${database || 'default'}.${username}`;
        
        if (UserManagementPanel.currentPanels.has(key)) {
            UserManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'managePermissions',
            `Permissions: ${username}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        UserManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            UserManagementPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = database || 'postgres';
            
            // Get current permissions
            const permsResult = await sqlService.executeQuery(`
                SELECT 
                    n.nspname as schema_name,
                    c.relname as table_name,
                    c.relkind as object_type,
                    array_agg(DISTINCT privilege_type) as privileges
                FROM information_schema.role_table_grants
                JOIN pg_class c ON c.relname = table_name
                JOIN pg_namespace n ON n.nspname = table_schema
                WHERE grantee = $1
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                GROUP BY n.nspname, c.relname, c.relkind
                ORDER BY n.nspname, c.relname
            `, [username], targetDb);

            // Get database privileges
            const dbPermsResult = await sqlService.executeQuery(`
                SELECT 
                    d.datname as database_name,
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'CONNECT') THEN ARRAY['CONNECT']
                        ELSE ARRAY[]::text[]
                    END ||
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'CREATE') THEN ARRAY['CREATE']
                        ELSE ARRAY[]::text[]
                    END ||
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'TEMPORARY') THEN ARRAY['TEMPORARY']
                        ELSE ARRAY[]::text[]
                    END as privileges
                FROM pg_database d
                WHERE d.datname NOT IN ('template0', 'template1')
                    AND d.datistemplate = false
                    AND (
                        has_database_privilege($1, d.datname, 'CONNECT')
                        OR has_database_privilege($1, d.datname, 'CREATE')
                        OR has_database_privilege($1, d.datname, 'TEMPORARY')
                    )
            `, [username], targetDb);

            // Get available schemas and tables
            const schemasResult = await sqlService.executeQuery(`
                SELECT schema_name
                FROM information_schema.schemata
                WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                ORDER BY schema_name
            `, [], targetDb);

            panel.webview.html = UserManagementPanel.getManagePermissionsHtml(
                username,
                permsResult.rows,
                dbPermsResult.rows,
                schemasResult.rows.map(s => s.schema_name)
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'grantPermission':
                        await UserManagementPanel.executeGrantPermission(
                            context,
                            stateService,
                            username,
                            message.grant,
                            targetDb,
                            panel
                        );
                        break;
                    case 'confirmRevoke':
                        // Show VS Code confirmation dialog
                        const confirmed = await vscode.window.showWarningMessage(
                            message.confirmMessage,
                            { modal: true },
                            'Revoke'
                        );
                        
                        if (confirmed === 'Revoke') {
                            await UserManagementPanel.executeRevokePermission(
                                context,
                                stateService,
                                username,
                                message.revoke,
                                targetDb,
                                panel
                            );
                        }
                        break;
                    case 'revokePermission':
                        await UserManagementPanel.executeRevokePermission(
                            context,
                            stateService,
                            username,
                            message.revoke,
                            targetDb,
                            panel
                        );
                        break;
                    case 'openAddPermissions':
                        await UserManagementPanel.addPermissions(
                            context,
                            stateService,
                            username,
                            message.schemas,
                            database
                        );
                        break;
                }
            });

        } catch (error) {
            let errorMessage: string;
            
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                // Handle plain objects
                const err = error as any;
                if (err.message) {
                    errorMessage = err.message;
                } else {
                    errorMessage = JSON.stringify(error, null, 2);
                }
            } else {
                errorMessage = String(error);
            }
            
            console.error('Failed to load permissions:', error);
            vscode.window.showErrorMessage(`Failed to load permissions: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Add permissions for a user (child panel)
     */
    public static async addPermissions(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        schemas: string[],
        database?: string
    ): Promise<void> {
        const key = `addperms_${database || 'default'}.${username}`;
        
        if (UserManagementPanel.currentPanels.has(key)) {
            UserManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'addPermissions',
            `Add Permissions: ${username}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        UserManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            UserManagementPanel.currentPanels.delete(key);
        });

        try {
            panel.webview.html = UserManagementPanel.getAddPermissionsHtml(username, schemas);

            const targetDb = database || 'postgres';

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'grantPermission':
                        // Find the parent permissions panel first
                        const parentKey = `perms_${database || 'default'}.${username}`;
                        const parentPanel = UserManagementPanel.currentPanels.get(parentKey);
                        
                        // Execute the grant with the parent panel to send refresh message there
                        await UserManagementPanel.executeGrantPermission(
                            context,
                            stateService,
                            username,
                            message.grant,
                            targetDb,
                            parentPanel || panel  // Use parent if available, otherwise child
                        );
                        
                        // Close the child panel after successful grant
                        panel.dispose();
                        
                        // Reveal the parent permissions panel
                        if (parentPanel) {
                            parentPanel.reveal();
                        }
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
                const err = error as any;
                if (err.message) {
                    errorMessage = err.message;
                } else {
                    errorMessage = JSON.stringify(error, null, 2);
                }
            } else {
                errorMessage = String(error);
            }
            
            console.error('Failed to open add permissions:', error);
            vscode.window.showErrorMessage(`Failed to open add permissions: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Drop a user/role
     */
    public static async dropUser(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        database?: string
    ): Promise<void> {
        try {
            const sql = `DROP ROLE ${username};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = database || 'postgres';
            await sqlService.executeQuery(sql, targetDb);

            vscode.window.showInformationMessage(`User/role "${username}" dropped successfully!`);
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to drop user: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Change user password
     */
    public static async changePassword(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'changePassword',
            `Change Password: ${username}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        try {
            panel.webview.html = UserManagementPanel.getChangePasswordHtml(username);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'changePassword':
                        await UserManagementPanel.executeChangePassword(
                            context,
                            stateService,
                            username,
                            message.password,
                            database,
                            panel
                        );
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            vscode.window.showErrorMessage(`Failed to open change password panel: ${errorMessage}`);
            panel.dispose();
        }
    }

    private static async executeChangePassword(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        password: string,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = `ALTER ROLE "${username}" WITH PASSWORD '${password.replace(/'/g, "''")}';`;
            
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = database || 'postgres';
            await sqlService.executeQuery(sql, targetDb);

            vscode.window.showInformationMessage(`Password for "${username}" changed successfully!`);
            panel.dispose();
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                const err = error as any;
                errorMessage = err.message || JSON.stringify(error, null, 2);
            } else {
                errorMessage = String(error);
            }
            
            // Parse Neon control plane errors for better readability
            const controlPlaneMatch = errorMessage.match(/Received HTTP code \d+ from control plane: ({.*})/);
            if (controlPlaneMatch) {
                try {
                    const errorObj = JSON.parse(controlPlaneMatch[1]);
                    if (errorObj.error) {
                        errorMessage = errorObj.error;
                    }
                } catch (parseError) {
                    // If parsing fails, use the original message
                }
            }
            
            console.error('Change password error:', errorMessage);
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    private static getChangePasswordHtml(username: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Change Password</title>
    <style>
        ${getStyles()}
    </style>
    <style>
        /* Password toggle styles */
        .password-input-container {
            position: relative;
            display: flex;
            align-items: center;
        }
        
        .password-input-container input {
            flex: 1;
            padding-right: 40px;
        }
        
        .password-toggle {
            position: absolute;
            right: 8px;
            background: none;
            border: none;
            color: var(--vscode-input-foreground);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
            transition: opacity 0.2s;
            width: 24px;
            height: 24px;
        }
        
        .password-toggle svg {
            width: 16px;
            height: 16px;
        }
        
        .password-toggle:hover {
            opacity: 1;
        }
        
        .password-toggle:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 2px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Change Password: ${username}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>New Password <span class="required">*</span></label>
                <div class="password-input-container">
                    <input type="password" id="password" />
                    <button type="button" class="password-toggle" id="passwordToggle" title="Show password">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 3C4.5 3 1.5 5.5 0.5 8C1.5 10.5 4.5 13 8 13C11.5 13 14.5 10.5 15.5 8C14.5 5.5 11.5 3 8 3ZM8 11.5C6.067 11.5 4.5 9.933 4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5ZM8 6C6.895 6 6 6.895 6 8C6 9.105 6.895 10 8 10C9.105 10 10 9.105 10 8C10 6.895 9.105 6 8 6Z" fill="currentColor"/>
                        </svg>
                    </button>
                </div>
                <div class="info-text">Must be at least 8 characters with uppercase, lowercase, numbers, and special characters for best results.</div>
            </div>

            <div class="form-group">
                <label>Confirm Password <span class="required">*</span></label>
                <div class="password-input-container">
                    <input type="password" id="confirmPassword" />
                    <button type="button" class="password-toggle" id="confirmPasswordToggle" title="Show password">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 3C4.5 3 1.5 5.5 0.5 8C1.5 10.5 4.5 13 8 13C11.5 13 14.5 10.5 15.5 8C14.5 5.5 11.5 3 8 3ZM8 11.5C6.067 11.5 4.5 9.933 4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5ZM8 6C6.895 6 6 6.895 6 8C6 9.105 6.895 10 8 10C9.105 10 10 9.105 10 8C10 6.895 9.105 6 8 6Z" fill="currentColor"/>
                        </svg>
                    </button>
                </div>
                <div class="info-text">Re-enter your password to confirm</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="changeBtn">Change Password</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // SVG icons
        const eyeIcon = \`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3C4.5 3 1.5 5.5 0.5 8C1.5 10.5 4.5 13 8 13C11.5 13 14.5 10.5 15.5 8C14.5 5.5 11.5 3 8 3ZM8 11.5C6.067 11.5 4.5 9.933 4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5ZM8 6C6.895 6 6 6.895 6 8C6 9.105 6.895 10 8 10C9.105 10 10 9.105 10 8C10 6.895 9.105 6 8 6Z" fill="currentColor"/>
        </svg>\`;
        
        const eyeOffIcon = \`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3C4.5 3 1.5 5.5 0.5 8C1.5 10.5 4.5 13 8 13C11.5 13 14.5 10.5 15.5 8C14.5 5.5 11.5 3 8 3ZM8 11.5C6.067 11.5 4.5 9.933 4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5ZM8 6C6.895 6 6 6.895 6 8C6 9.105 6.895 10 8 10C9.105 10 10 9.105 10 8C10 6.895 9.105 6 8 6Z" fill="currentColor"/>
            <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>\`;

        // Password visibility toggles
        function setupPasswordToggle(inputId, toggleId) {
            const passwordToggle = document.getElementById(toggleId);
            const passwordInput = document.getElementById(inputId);
            
            passwordToggle.addEventListener('click', () => {
                const isPassword = passwordInput.type === 'password';
                passwordInput.type = isPassword ? 'text' : 'password';
                
                if (isPassword) {
                    passwordToggle.innerHTML = eyeOffIcon;
                    passwordToggle.title = 'Hide password';
                } else {
                    passwordToggle.innerHTML = eyeIcon;
                    passwordToggle.title = 'Show password';
                }
            });
        }

        setupPasswordToggle('password', 'passwordToggle');
        setupPasswordToggle('confirmPassword', 'confirmPasswordToggle');

        function validatePassword() {
            clearError();
            
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;
            
            if (!password) {
                showError('Password is required');
                return false;
            }
            
            if (password.length < 8) {
                showError('Password must be at least 8 characters long');
                return false;
            }
            
            const hasUpperCase = /[A-Z]/.test(password);
            const hasLowerCase = /[a-z]/.test(password);
            const hasNumber = /[0-9]/.test(password);
            const hasSpecialChar = /[!@#$%^&*()_+\\-=\\[\\]{};':"\\\\|,.<>\\/?]/.test(password);
            
            const missing = [];
            if (!hasUpperCase) missing.push('uppercase letters');
            if (!hasLowerCase) missing.push('lowercase letters');
            if (!hasNumber) missing.push('numbers');
            if (!hasSpecialChar) missing.push('special characters');
            
            if (missing.length >= 3) {
                showError(\`Password is too weak. Include \${missing.join(', ')} for better security.\`);
                return false;
            }

            if (!confirmPassword) {
                showError('Please confirm your password');
                return false;
            }
            
            if (password !== confirmPassword) {
                showError('Passwords do not match');
                return false;
            }
            
            return true;
        }

        document.getElementById('changeBtn').addEventListener('click', () => {
            if (!validatePassword()) return;
            
            vscode.postMessage({
                command: 'changePassword',
                password: document.getElementById('password').value
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        // Allow Enter key to submit
        document.getElementById('confirmPassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                document.getElementById('changeBtn').click();
            }
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
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

        // Focus on password field
        document.getElementById('password').focus();
    </script>
</body>
</html>`;
    }

    /**
     * Edit role
     */
    public static async editRole(
        context: vscode.ExtensionContext,
        stateService: StateService,
        roleName: string,
        database?: string
    ): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'editRole',
            `Edit Role: ${roleName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        try {
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = database || 'postgres';

            // Fetch current role details
            const roleResult = await sqlService.executeQuery(`
                SELECT 
                    r.rolname as name,
                    r.rolsuper as is_superuser,
                    r.rolcreatedb as can_create_db,
                    r.rolcreaterole as can_create_role,
                    r.rolcanlogin as can_login,
                    r.rolconnlimit as connection_limit,
                    r.rolvaliduntil as valid_until,
                    ARRAY(
                        SELECT m.rolname 
                        FROM pg_auth_members am
                        JOIN pg_roles m ON am.roleid = m.oid
                        WHERE am.member = r.oid
                    ) as member_of
                FROM pg_catalog.pg_roles r
                WHERE r.rolname = $1
            `, [roleName], targetDb);

            if (roleResult.rows.length === 0) {
                vscode.window.showErrorMessage(`Role "${roleName}" not found`);
                panel.dispose();
                return;
            }

            const currentRole = roleResult.rows[0];

            // Parse member_of array
            let memberOfArray: string[] = [];
            if (currentRole.member_of) {
                if (Array.isArray(currentRole.member_of)) {
                    memberOfArray = currentRole.member_of;
                } else if (typeof currentRole.member_of === 'string') {
                    const match = currentRole.member_of.match(/^\{(.*)\}$/);
                    if (match) {
                        memberOfArray = match[1] ? match[1].split(',').map((s: string) => s.trim()) : [];
                    }
                }
            }

            // Get available roles (excluding system roles and the role itself)
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname 
                FROM pg_catalog.pg_roles 
                WHERE rolname NOT LIKE 'pg_%' 
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser', $1)
                ORDER BY rolname
            `, [roleName], targetDb);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);

            // Add neon_superuser back to the list for membership
            existingRoles.push('neon_superuser');
            existingRoles.sort();

            panel.webview.html = UserManagementPanel.getEditRoleHtml(
                roleName,
                currentRole,
                memberOfArray,
                existingRoles
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'editRole':
                        await UserManagementPanel.executeEditRole(
                            context,
                            stateService,
                            roleName,
                            message.userDef,
                            targetDb,
                            panel
                        );
                        break;
                    case 'previewSql':
                        const sql = UserManagementPanel.generateEditRoleSql(roleName, message.userDef);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            vscode.window.showErrorMessage(`Failed to open edit role panel: ${errorMessage}`);
            panel.dispose();
        }
    }

    private static generateEditRoleSql(roleName: string, userDef: any): string {
        const statements: string[] = [];
        const currentRoleName = roleName;
        const newRoleName = userDef.roleName || roleName;
        
        // Rename (if name changed)
        if (newRoleName !== currentRoleName) {
            statements.push(`ALTER ROLE "${currentRoleName}" RENAME TO "${newRoleName}";`);
        }
        
        // Use new role name for subsequent ALTER statements
        const targetRoleName = newRoleName;
        
        // Can Login
        if (userDef.canLogin) {
            statements.push(`ALTER ROLE "${targetRoleName}" WITH LOGIN;`);
        } else {
            statements.push(`ALTER ROLE "${targetRoleName}" WITH NOLOGIN;`);
        }
        
        // Can Create DB
        if (userDef.canCreateDb) {
            statements.push(`ALTER ROLE "${targetRoleName}" WITH CREATEDB;`);
        } else {
            statements.push(`ALTER ROLE "${targetRoleName}" WITH NOCREATEDB;`);
        }
        
        // Can Create Role
        if (userDef.canCreateRole) {
            statements.push(`ALTER ROLE "${targetRoleName}" WITH CREATEROLE;`);
        } else {
            statements.push(`ALTER ROLE "${targetRoleName}" WITH NOCREATEROLE;`);
        }
        
        // Connection Limit
        if (userDef.connectionLimit !== undefined) {
            statements.push(`ALTER ROLE "${targetRoleName}" CONNECTION LIMIT ${userDef.connectionLimit};`);
        }
        
        // Valid Until
        if (userDef.validUntil) {
            statements.push(`ALTER ROLE "${targetRoleName}" VALID UNTIL '${userDef.validUntil}';`);
        }
        
        return statements.join('\n');
    }

    private static async executeEditRole(
        context: vscode.ExtensionContext,
        stateService: StateService,
        roleName: string,
        userDef: any,
        database: string,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Validate new role name if it changed
            const newRoleName = userDef.roleName?.trim() || roleName;
            if (newRoleName !== roleName) {
                // Validate role name format
                if (!/^[a-z_][a-z0-9_]*$/i.test(newRoleName)) {
                    panel.webview.postMessage({
                        command: 'error',
                        error: 'Role name must start with a letter or underscore and contain only letters, numbers, and underscores'
                    });
                    return;
                }
                
                // Check if new name already exists
                const existingResult = await sqlService.executeQuery(
                    `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1`,
                    [newRoleName],
                    database
                );
                
                if (existingResult.rows.length > 0) {
                    panel.webview.postMessage({
                        command: 'error',
                        error: `Role "${newRoleName}" already exists`
                    });
                    return;
                }
            }
            
            const statements: string[] = [];
            let currentRoleName = roleName;
            
            // Rename (if name changed)
            if (newRoleName !== roleName) {
                statements.push(`ALTER ROLE "${roleName}" RENAME TO "${newRoleName}"`);
                currentRoleName = newRoleName;
            }
            
            // Can Login
            if (userDef.canLogin) {
                statements.push(`ALTER ROLE "${currentRoleName}" WITH LOGIN`);
            } else {
                statements.push(`ALTER ROLE "${currentRoleName}" WITH NOLOGIN`);
            }
            
            // Can Create DB
            if (userDef.canCreateDb) {
                statements.push(`ALTER ROLE "${currentRoleName}" WITH CREATEDB`);
            } else {
                statements.push(`ALTER ROLE "${currentRoleName}" WITH NOCREATEDB`);
            }
            
            // Can Create Role
            if (userDef.canCreateRole) {
                statements.push(`ALTER ROLE "${currentRoleName}" WITH CREATEROLE`);
            } else {
                statements.push(`ALTER ROLE "${currentRoleName}" WITH NOCREATEROLE`);
            }
            
            // Connection Limit
            if (userDef.connectionLimit !== undefined) {
                statements.push(`ALTER ROLE "${currentRoleName}" CONNECTION LIMIT ${userDef.connectionLimit}`);
            }
            
            // Valid Until
            if (userDef.validUntil) {
                statements.push(`ALTER ROLE "${currentRoleName}" VALID UNTIL '${userDef.validUntil}'`);
            }
            
            // Execute all ALTER statements
            for (const stmt of statements) {
                await sqlService.executeQuery(stmt, database);
            }
            
            // Handle role membership changes
            if (userDef.memberOf && Array.isArray(userDef.memberOf)) {
                // Get current memberships (using currentRoleName in case it was renamed)
                const currentResult = await sqlService.executeQuery(`
                    SELECT ARRAY(
                        SELECT m.rolname 
                        FROM pg_auth_members am
                        JOIN pg_roles m ON am.roleid = m.oid
                        WHERE am.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
                    ) as member_of
                `, [currentRoleName], database);
                
                let currentMemberOf: string[] = [];
                if (currentResult.rows[0]?.member_of) {
                    const memberOfStr = currentResult.rows[0].member_of;
                    if (Array.isArray(memberOfStr)) {
                        currentMemberOf = memberOfStr;
                    } else if (typeof memberOfStr === 'string') {
                        const match = memberOfStr.match(/^\{(.*)\}$/);
                        if (match) {
                            currentMemberOf = match[1] ? match[1].split(',').map((s: string) => s.trim()) : [];
                        }
                    }
                }
                
                // Revoke removed memberships
                for (const role of currentMemberOf) {
                    if (!userDef.memberOf.includes(role)) {
                        await sqlService.executeQuery(`REVOKE "${role}" FROM "${currentRoleName}"`, database);
                    }
                }
                
                // Grant new memberships
                for (const role of userDef.memberOf) {
                    if (!currentMemberOf.includes(role)) {
                        await sqlService.executeQuery(`GRANT "${role}" TO "${currentRoleName}"`, database);
                    }
                }
            }
            
            vscode.window.showInformationMessage(`Role "${currentRoleName}" updated successfully!`);
            panel.dispose();
            
            // Refresh the schema view
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                const err = error as any;
                errorMessage = err.message || JSON.stringify(error, null, 2);
            } else {
                errorMessage = String(error);
            }
            
            console.error('Edit role error:', errorMessage);
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    private static getEditRoleHtml(
        roleName: string,
        currentRole: any,
        currentMemberOf: string[],
        existingRoles: string[]
    ): string {
        const rolesJson = JSON.stringify(existingRoles);
        const currentMemberOfJson = JSON.stringify(currentMemberOf);
        const validUntil = currentRole.valid_until ? new Date(currentRole.valid_until).toISOString().slice(0, 16) : '';
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Role</title>
    ${getStyles()}
</head>
<body>
    <div class="container">
        <h1>Edit Role: ${roleName}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Role Name <span class="required">*</span></label>
                <input type="text" id="roleName" value="${roleName}" />
                <div class="info-text">Must start with a letter and contain only letters, numbers, and underscores</div>
            </div>

            <div class="checkbox-group" id="canLoginGroup">
                <input type="checkbox" id="canLogin" ${currentRole.can_login ? 'checked' : ''} />
                <label for="canLogin" style="margin: 0;">Can Login</label>
            </div>
            <div class="info-text">Allow this user to log in to the database</div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('advancedSettings')">
                <span class="toggle-icon" id="advancedSettingsIcon">▶</span> Advanced Settings
            </div>
            <div class="collapsible-content" id="advancedSettingsContent" style="display: none;">
                <div class="form-group">
                    <label>Role Membership (optional)</label>
                    <div class="info-text" style="margin-bottom: 8px;">Make this user a member of existing roles (e.g., neon_superuser for superuser privileges)</div>
                    <div id="rolesList"></div>
                </div>

                <div style="margin-top: 16px;">
                    <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: var(--vscode-foreground);">Privileges</h3>
                    
                    <div class="checkbox-group">
                        <input type="checkbox" id="canCreateDb" ${currentRole.can_create_db ? 'checked' : ''} />
                        <label for="canCreateDb" style="margin: 0;">Can Create Databases</label>
                    </div>

                    <div class="checkbox-group">
                        <input type="checkbox" id="canCreateRole" ${currentRole.can_create_role ? 'checked' : ''} />
                        <label for="canCreateRole" style="margin: 0;">Can Create Roles</label>
                    </div>
                </div>

                <div class="form-group" style="margin-top: 16px;">
                    <label>Connection Limit</label>
                    <input type="number" id="connectionLimit" value="${currentRole.connection_limit}" min="-1" />
                    <div class="info-text">-1 for unlimited, 0 to prevent connections</div>
                </div>

                <div class="form-group">
                    <label>Valid Until (optional)</label>
                    <input type="datetime-local" id="validUntil" value="${validUntil}" />
                    <div class="info-text">Expiration date/time for this user</div>
                </div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreview')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span> SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreview" style="display: none;">
                <div class="sql-preview" id="sqlPreviewContent">-- Make changes to see SQL preview</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="editBtn">Update Role</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const existingRoles = ${rolesJson};
        const currentMemberOf = ${currentMemberOfJson};
        const originalRoleName = '${roleName}';
        let selectedRoles = [...currentMemberOf];

        const rolesList = document.getElementById('rolesList');
        existingRoles.forEach(role => {
            const div = document.createElement('div');
            div.className = 'checkbox-group';
            div.innerHTML = \`
                <input type="checkbox" id="role_\${role}" value="\${role}" \${selectedRoles.includes(role) ? 'checked' : ''} />
                <label for="role_\${role}" style="margin: 0;">\${role}</label>
            \`;
            div.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedRoles.push(role);
                } else {
                    selectedRoles = selectedRoles.filter(r => r !== role);
                }
                updatePreview();
            });
            rolesList.appendChild(div);
        });

        function getUserDefinition() {
            return {
                roleName: document.getElementById('roleName').value.trim(),
                canLogin: document.getElementById('canLogin').checked,
                canCreateDb: document.getElementById('canCreateDb').checked,
                canCreateRole: document.getElementById('canCreateRole').checked,
                connectionLimit: parseInt(document.getElementById('connectionLimit').value),
                validUntil: document.getElementById('validUntil').value,
                memberOf: selectedRoles
            };
        }

        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId === 'advancedSettings' ? 'advancedSettingsContent' : sectionId);
            const icon = document.getElementById(sectionId + 'Icon');
            const isExpanded = content.style.display === 'block';
            content.style.display = isExpanded ? 'none' : 'block';
            icon.classList.toggle('expanded', !isExpanded);
        }

        function updatePreview() {
            vscode.postMessage({
                command: 'previewSql',
                userDef: getUserDefinition()
            });
        }

        // Add event listeners for auto-updating preview
        document.getElementById('roleName').addEventListener('input', updatePreview);
        document.getElementById('canLogin').addEventListener('change', updatePreview);
        document.getElementById('canCreateDb').addEventListener('change', updatePreview);
        document.getElementById('canCreateRole').addEventListener('change', updatePreview);
        document.getElementById('connectionLimit').addEventListener('input', updatePreview);
        document.getElementById('validUntil').addEventListener('change', updatePreview);

        document.getElementById('editBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'editRole',
                userDef: getUserDefinition()
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'sqlPreview':
                    document.getElementById('sqlPreviewContent').textContent = message.sql;
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
     * Execute create user
     */
    private static async executeCreateUser(
        context: vscode.ExtensionContext,
        stateService: StateService,
        userDef: UserDefinition & { memberOf?: string[] },
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            if (userDef.roleType === 'neon') {
                // Create role via Neon API with auto-generated password
                const apiService = new NeonApiService(context);
                
                // Get current project and branch IDs from state
                // Try multiple sources in order of preference
                let projectId: string | undefined;
                let branchId: string | undefined;
                
                // 1. Try getCurrentProjectId/getCurrentBranchId (active selection)
                try {
                    projectId = await stateService.getCurrentProjectId();
                    branchId = await stateService.getCurrentBranchId();
                    console.log('🔍 From getCurrentProjectId/Branch:', { projectId, branchId });
                } catch (error) {
                    console.log('🔍 getCurrentProjectId/Branch failed:', error);
                }
                
                // 2. Try viewData.connection (UI connection state)
                if (!projectId || !branchId) {
                    try {
                        const viewData = await stateService.getViewData();
                        console.log('🔍 ViewData.connection:', JSON.stringify(viewData.connection, null, 2));
                        projectId = projectId || viewData.connection?.selectedProjectId;
                        // Branch ID can be in selectedBranchId OR currentlyConnectedBranch
                        branchId = branchId || viewData.connection?.selectedBranchId || viewData.connection?.currentlyConnectedBranch;
                        console.log('🔍 From viewData.connection:', { projectId, branchId });
                    } catch (error) {
                        console.log('🔍 getViewData failed:', error);
                    }
                }
                
                if (!projectId || !branchId) {
                    panel.webview.postMessage({
                        command: 'error',
                        error: 'Unable to determine project or branch. Neon superuser roles can only be created when connected through the extension. ' +
                               'Please try: 1) Reconnecting to your database using the extension\'s connect button, or 2) Create a SQL role instead (which doesn\'t require Neon API access).'
                    });
                    return;
                }
                
                // Create role via API
                const response = await apiService.createRole(projectId, branchId, userDef.username);
                
                // Show success with generated password
                const password = response.role.password || '(password not provided)';
                
                // Copy password to clipboard
                await vscode.env.clipboard.writeText(password);
                
                // Show notification
                vscode.window.showInformationMessage(
                    `✅ Neon role "${userDef.username}" created! Password copied to clipboard: ${password}`
                );
                
                // Refresh the schema view to show the new role
                await vscode.commands.executeCommand('neonLocal.schema.refresh');
                panel.dispose();
            } else {
                // Create role via SQL with manual password
            const sql = UserManagementPanel.generateCreateUserSql(userDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

                vscode.window.showInformationMessage(`SQL role "${userDef.username}" created successfully!`);
                
                // Refresh the schema view to show the new role
                await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            }
            
        } catch (error) {
            let errorMessage: string;
            
            // Extract error message from various error types
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                const err = error as any;
                if (err.message) {
                    errorMessage = err.message;
                } else {
                    errorMessage = JSON.stringify(error, null, 2);
                }
            } else {
                errorMessage = String(error);
            }
            
            // Parse Neon control plane errors for better readability
            const controlPlaneMatch = errorMessage.match(/Received HTTP code \d+ from control plane: ({.*})/);
            if (controlPlaneMatch) {
                try {
                    const errorObj = JSON.parse(controlPlaneMatch[1]);
                    if (errorObj.error) {
                        errorMessage = errorObj.error;
                    }
                } catch (parseError) {
                    // If parsing fails, use the original message
                }
            }
            
            console.error('Create user error:', errorMessage);
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Execute grant permission
     */
    private static async executeGrantPermission(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        grant: PermissionGrant,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = UserManagementPanel.generateGrantSql(username, grant);
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = database || 'postgres';
            await sqlService.executeQuery(sql, targetDb);

            // Refresh permissions data
            const permsResult = await sqlService.executeQuery(`
                SELECT 
                    n.nspname as schema_name,
                    c.relname as table_name,
                    c.relkind as object_type,
                    array_agg(DISTINCT privilege_type) as privileges
                FROM information_schema.role_table_grants
                JOIN pg_class c ON c.relname = table_name
                JOIN pg_namespace n ON n.nspname = table_schema
                WHERE grantee = $1
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                GROUP BY n.nspname, c.relname, c.relkind
                ORDER BY n.nspname, c.relname
            `, [username], targetDb);

            const dbPermsResult = await sqlService.executeQuery(`
                SELECT 
                    d.datname as database_name,
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'CONNECT') THEN ARRAY['CONNECT']
                        ELSE ARRAY[]::text[]
                    END ||
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'CREATE') THEN ARRAY['CREATE']
                        ELSE ARRAY[]::text[]
                    END ||
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'TEMPORARY') THEN ARRAY['TEMPORARY']
                        ELSE ARRAY[]::text[]
                    END as privileges
                FROM pg_database d
                WHERE d.datname NOT IN ('template0', 'template1')
                    AND d.datistemplate = false
                    AND (
                        has_database_privilege($1, d.datname, 'CONNECT')
                        OR has_database_privilege($1, d.datname, 'CREATE')
                        OR has_database_privilege($1, d.datname, 'TEMPORARY')
                    )
            `, [username], targetDb);

            vscode.window.showInformationMessage(`Permissions granted to "${username}"!`);
            panel.webview.postMessage({ 
                command: 'refreshPermissions',
                permissions: permsResult.rows,
                dbPermissions: dbPermsResult.rows
            });
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                const err = error as any;
                errorMessage = err.message || JSON.stringify(error, null, 2);
            } else {
                errorMessage = String(error);
            }
            
            console.error('Grant permission error:', errorMessage);
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Execute revoke permission
     */
    private static async executeRevokePermission(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        revoke: PermissionGrant,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = UserManagementPanel.generateRevokeSql(username, revoke);
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = database || 'postgres';
            await sqlService.executeQuery(sql, targetDb);

            // Refresh permissions data
            const permsResult = await sqlService.executeQuery(`
                SELECT 
                    n.nspname as schema_name,
                    c.relname as table_name,
                    c.relkind as object_type,
                    array_agg(DISTINCT privilege_type) as privileges
                FROM information_schema.role_table_grants
                JOIN pg_class c ON c.relname = table_name
                JOIN pg_namespace n ON n.nspname = table_schema
                WHERE grantee = $1
                    AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                GROUP BY n.nspname, c.relname, c.relkind
                ORDER BY n.nspname, c.relname
            `, [username], targetDb);

            const dbPermsResult = await sqlService.executeQuery(`
                SELECT 
                    d.datname as database_name,
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'CONNECT') THEN ARRAY['CONNECT']
                        ELSE ARRAY[]::text[]
                    END ||
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'CREATE') THEN ARRAY['CREATE']
                        ELSE ARRAY[]::text[]
                    END ||
                    CASE 
                        WHEN has_database_privilege($1, d.datname, 'TEMPORARY') THEN ARRAY['TEMPORARY']
                        ELSE ARRAY[]::text[]
                    END as privileges
                FROM pg_database d
                WHERE d.datname NOT IN ('template0', 'template1')
                    AND d.datistemplate = false
                    AND (
                        has_database_privilege($1, d.datname, 'CONNECT')
                        OR has_database_privilege($1, d.datname, 'CREATE')
                        OR has_database_privilege($1, d.datname, 'TEMPORARY')
                    )
            `, [username], targetDb);

            vscode.window.showInformationMessage(`Permissions revoked from "${username}"!`);
            panel.webview.postMessage({ 
                command: 'refreshPermissions',
                permissions: permsResult.rows,
                dbPermissions: dbPermsResult.rows
            });
            
        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                const err = error as any;
                errorMessage = err.message || JSON.stringify(error, null, 2);
            } else {
                errorMessage = String(error);
            }
            
            console.error('Revoke permission error:', errorMessage);
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Generate CREATE USER SQL
     */
    private static generateCreateUserSql(userDef: UserDefinition & { memberOf?: string[] }): string {
        const {
            username,
            password,
            canLogin,
            isSuperuser,
            canCreateDb,
            canCreateRole,
            connectionLimit,
            validUntil,
            memberOf
        } = userDef;

        let sql = `CREATE ROLE ${username}`;
        
        const options: string[] = [];
        
        if (canLogin) {
            options.push('LOGIN');
        } else {
            options.push('NOLOGIN');
        }
        
        if (isSuperuser) {
            options.push('SUPERUSER');
        }
        
        if (canCreateDb) {
            options.push('CREATEDB');
        }
        
        if (canCreateRole) {
            options.push('CREATEROLE');
        }
        
        if (connectionLimit >= 0) {
            options.push(`CONNECTION LIMIT ${connectionLimit}`);
        }
        
        if (password) {
            options.push(`PASSWORD '${password.replace(/'/g, "''")}'`);
        }
        
        if (validUntil) {
            options.push(`VALID UNTIL '${validUntil}'`);
        }
        
        if (options.length > 0) {
            sql += ' WITH ' + options.join(' ');
        }
        
        sql += ';';
        
        // Add role memberships
        if (memberOf && memberOf.length > 0) {
            memberOf.forEach(role => {
                sql += `\nGRANT ${role} TO ${username};`;
            });
        }
        
        return sql;
    }

    /**
     * Generate GRANT SQL
     */
    private static generateGrantSql(username: string, grant: PermissionGrant): string {
        const { schema, objectType, objectName, privileges, grantOption, applyToFuture } = grant;
        
        const privStr = privileges.join(', ');
        const grantOptStr = grantOption ? ' WITH GRANT OPTION' : '';
        
        let sql: string;
        
        if (objectType === 'schema') {
            sql = `GRANT ${privStr} ON SCHEMA ${schema} TO ${username}${grantOptStr};`;
        } else if (objectType === 'database') {
            sql = `GRANT ${privStr} ON DATABASE ${objectName} TO ${username}${grantOptStr};`;
        } else {
            const objectRef = objectName === '*' ? `ALL ${objectType.toUpperCase()}S IN SCHEMA ${schema}` : `${schema}.${objectName}`;
            sql = `GRANT ${privStr} ON ${objectRef} TO ${username}${grantOptStr};`;
            
            // Add ALTER DEFAULT PRIVILEGES for future objects if requested
            if (applyToFuture && objectName === '*') {
                sql += `\nALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ${privStr} ON ${objectType.toUpperCase()}S TO ${username}${grantOptStr};`;
            }
        }
        
        return sql;
    }

    /**
     * Generate REVOKE SQL
     */
    private static generateRevokeSql(username: string, revoke: PermissionGrant): string {
        const { schema, objectType, objectName, privileges } = revoke;
        
        const privStr = privileges.join(', ');
        
        let sql: string;
        
        if (objectType === 'schema') {
            sql = `REVOKE ${privStr} ON SCHEMA ${schema} FROM ${username};`;
        } else if (objectType === 'database') {
            sql = `REVOKE ${privStr} ON DATABASE ${objectName} FROM ${username};`;
        } else {
            const objectRef = objectName === '*' ? `ALL ${objectType.toUpperCase()}S IN SCHEMA ${schema}` : `${schema}.${objectName}`;
            sql = `REVOKE ${privStr} ON ${objectRef} FROM ${username};`;
        }
        
        return sql;
    }

    /**
     * Get HTML for users list panel
     */
    private static getUsersListHtml(users: any[]): string {
        const usersJson = JSON.stringify(users);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>User & Role Management</title>
    ${getStyles()}
    <style>
        /* User management specific styles */
        .container {
            max-width: 1000px;
        }
        
        .toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        
        .checkbox-group input[type="checkbox"] {
            cursor: pointer;
        }
        
        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-editor-background);
        }
        
        .btn-sm {
            padding: 4px 8px;
            font-size: 11px;
        }
        
        .success {
            color: var(--vscode-charts-green);
            background-color: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-charts-green);
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 16px;
        }
        
        .user-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 16px;
        }
        
        .user-table th,
        .user-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .user-table th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: 600;
            position: sticky;
            top: 0;
        }
        
        .user-table tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            margin-right: 4px;
        }
        
        .badge-superuser {
            background-color: var(--vscode-errorForeground);
            color: white;
        }
        
        .badge-login {
            background-color: var(--vscode-charts-green);
            color: white;
        }
        
        .badge-role {
            background-color: var(--vscode-charts-blue);
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>User & Role Management</h1>
        
        <div class="toolbar">
            <button class="btn btn-secondary" id="refreshBtn">🔄 Refresh</button>
        </div>

        <table class="user-table">
            <thead>
                <tr>
                    <th>Username/Role</th>
                    <th>Type</th>
                    <th>Privileges</th>
                    <th>Member Of</th>
                    <th>Connection Limit</th>
                </tr>
            </thead>
            <tbody id="usersTableBody">
                <!-- Populated by JavaScript -->
            </tbody>
        </table>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let users = ${usersJson};

        // Parse PostgreSQL array format to JavaScript array
        function parsePgArray(pgArray) {
            if (!pgArray) return [];
            if (Array.isArray(pgArray)) return pgArray;
            if (typeof pgArray === 'string') {
                // Handle PostgreSQL array format: {item1,item2}
                if (pgArray === '{}') return [];
                const cleaned = pgArray.replace(/^{|}$/g, '');
                return cleaned ? cleaned.split(',') : [];
            }
            return [];
        }

        function renderUsers() {
            const tbody = document.getElementById('usersTableBody');
            tbody.innerHTML = '';

            users.forEach(user => {
                const tr = document.createElement('tr');
                
                // Username
                const tdUsername = document.createElement('td');
                tdUsername.innerHTML = \`<strong>\${user.username}</strong>\`;
                tr.appendChild(tdUsername);
                
                // Type
                const tdType = document.createElement('td');
                if (user.is_superuser) {
                    tdType.innerHTML = '<span class="badge badge-superuser">SUPERUSER</span>';
                } else if (user.can_login) {
                    tdType.innerHTML = '<span class="badge badge-login">USER</span>';
                } else {
                    tdType.innerHTML = '<span class="badge badge-role">ROLE</span>';
                }
                tr.appendChild(tdType);
                
                // Privileges
                const tdPrivs = document.createElement('td');
                const privs = [];
                if (user.can_create_db) privs.push('CREATEDB');
                if (user.can_create_role) privs.push('CREATEROLE');
                if (user.can_replicate) privs.push('REPLICATION');
                tdPrivs.textContent = privs.length > 0 ? privs.join(', ') : '-';
                tr.appendChild(tdPrivs);
                
                // Member Of
                const tdMemberOf = document.createElement('td');
                const memberOf = parsePgArray(user.member_of);
                tdMemberOf.textContent = memberOf.length > 0 ? memberOf.join(', ') : '-';
                tr.appendChild(tdMemberOf);
                
                // Connection Limit
                const tdConnLimit = document.createElement('td');
                tdConnLimit.textContent = user.connection_limit === -1 ? 'Unlimited' : user.connection_limit;
                tr.appendChild(tdConnLimit);
                
                tbody.appendChild(tr);
            });
        }

        document.getElementById('refreshBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'updateUsers') {
                users = message.users;
                renderUsers();
            }
        });

        renderUsers();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for create user panel
     */
    private static getCreateUserHtml(existingRoles: string[]): string {
        const rolesJson = JSON.stringify(existingRoles);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Role</title>
    <style>
        ${getStyles()}
    </style>
    <style>
        /* Password toggle styles */
        .password-input-container {
            position: relative;
            display: flex;
            align-items: center;
        }
        
        .password-input-container input {
            flex: 1;
            padding-right: 40px;
        }
        
        .password-toggle {
            position: absolute;
            right: 8px;
            background: none;
            border: none;
            color: var(--vscode-input-foreground);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
            transition: opacity 0.2s;
            width: 24px;
            height: 24px;
        }
        
        .password-toggle svg {
            width: 16px;
            height: 16px;
        }
        
        .password-toggle:hover {
            opacity: 1;
        }
        
        .password-toggle:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 2px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Create Role</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Role Type <span class="required">*</span></label>
                <select id="roleType" onchange="updateRoleTypeUI()">
                    <option value="neon">Neon Role (Admin privileges via neon_superuser)</option>
                    <option value="sql">SQL Role (Basic privileges, manually configured)</option>
                </select>
                <div class="info-text" id="roleTypeInfo">
                    Neon roles are created via API with auto-generated passwords and automatically granted neon_superuser membership (CREATEDB, CREATEROLE, pg_read_all_data, pg_write_all_data, etc.)
                </div>
            </div>
            
            <div class="form-group">
                <label>Username/Role Name <span class="required">*</span></label>
                <input type="text" id="username" placeholder="myuser" />
                <div class="info-text">Must be unique and contain only letters, numbers, and underscores</div>
            </div>

            <div class="checkbox-group" id="canLoginGroup">
                <input type="checkbox" id="canLogin" checked />
                <label for="canLogin" style="margin: 0;">Can Login</label>
            </div>
            <div class="info-text" id="canLoginInfo" style="margin-bottom: 16px;">Allow this user to log in to the database</div>

            <div class="form-group" id="passwordGroup">
                <label>Password <span class="required" id="passwordRequired">*</span></label>
                <div class="password-input-container">
                    <input type="password" id="password" />
                    <button type="button" class="password-toggle" id="passwordToggle" title="Show password">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M8 3C4.5 3 1.5 5.5 0.5 8C1.5 10.5 4.5 13 8 13C11.5 13 14.5 10.5 15.5 8C14.5 5.5 11.5 3 8 3ZM8 11.5C6.067 11.5 4.5 9.933 4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5ZM8 6C6.895 6 6 6.895 6 8C6 9.105 6.895 10 8 10C9.105 10 10 9.105 10 8C10 6.895 9.105 6 8 6Z" fill="currentColor"/>
                        </svg>
                    </button>
            </div>
                <div class="info-text" id="passwordInfo">Must be 10+ characters with uppercase, lowercase, numbers, and special characters for best results.</div>
            </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('advancedSettings')">
                <span class="toggle-icon" id="advancedSettingsIcon">▶</span> Advanced Settings
            </div>
            <div class="collapsible-content" id="advancedSettingsContent" style="display: none;">
                <div class="form-group">
                    <label>Role Membership (optional)</label>
                    <div class="info-text" style="margin-bottom: 8px;">Make this user a member of existing roles (e.g., neon_superuser for superuser privileges)</div>
                    <div id="rolesList"></div>
                </div>

                <div style="margin-top: 16px;">
                    <h3 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: var(--vscode-foreground);">Privileges</h3>

            <div class="checkbox-group">
                <input type="checkbox" id="canCreateDb" />
                <label for="canCreateDb" style="margin: 0;">Can Create Databases</label>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="canCreateRole" />
                <label for="canCreateRole" style="margin: 0;">Can Create Roles</label>
            </div>
        </div>

                <div class="form-group" style="margin-top: 16px;">
                <label>Connection Limit</label>
                <input type="number" id="connectionLimit" value="-1" min="-1" />
                <div class="info-text">-1 for unlimited, 0 to prevent connections</div>
            </div>

            <div class="form-group">
                <label>Valid Until (optional)</label>
                <input type="datetime-local" id="validUntil" />
                <div class="info-text">Expiration date/time for this user</div>
            </div>
        </div>
        </div>

        <div class="section-box collapsible">
            <div class="collapsible-header" onclick="toggleSection('sqlPreview')">
                <span class="toggle-icon" id="sqlPreviewIcon">▶</span> SQL Preview
            </div>
            <div class="collapsible-content" id="sqlPreviewContent" style="display: none;">
                <div class="sql-preview" id="sqlPreview">-- Configure options above to see the CREATE ROLE statement</div>
            </div>
        </div>

        <div class="actions">
            <button class="btn" id="createBtn">Create Role</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const existingRoles = ${rolesJson};
        let selectedRoles = [];

        const rolesList = document.getElementById('rolesList');
        existingRoles.forEach(role => {
            const div = document.createElement('div');
            div.className = 'checkbox-group';
            div.innerHTML = \`
                <input type="checkbox" id="role_\${role}" value="\${role}" />
                <label for="role_\${role}" style="margin: 0;">\${role}</label>
            \`;
            div.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) {
                    selectedRoles.push(role);
                } else {
                    selectedRoles = selectedRoles.filter(r => r !== role);
                }
                updatePreview();
            });
            rolesList.appendChild(div);
        });

        // Password visibility toggle
        const passwordToggle = document.getElementById('passwordToggle');
        const passwordInput = document.getElementById('password');
        
        // SVG icons
        const eyeIcon = \`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3C4.5 3 1.5 5.5 0.5 8C1.5 10.5 4.5 13 8 13C11.5 13 14.5 10.5 15.5 8C14.5 5.5 11.5 3 8 3ZM8 11.5C6.067 11.5 4.5 9.933 4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5ZM8 6C6.895 6 6 6.895 6 8C6 9.105 6.895 10 8 10C9.105 10 10 9.105 10 8C10 6.895 9.105 6 8 6Z" fill="currentColor"/>
        </svg>\`;
        
        const eyeOffIcon = \`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3C4.5 3 1.5 5.5 0.5 8C1.5 10.5 4.5 13 8 13C11.5 13 14.5 10.5 15.5 8C14.5 5.5 11.5 3 8 3ZM8 11.5C6.067 11.5 4.5 9.933 4.5 8C4.5 6.067 6.067 4.5 8 4.5C9.933 4.5 11.5 6.067 11.5 8C11.5 9.933 9.933 11.5 8 11.5ZM8 6C6.895 6 6 6.895 6 8C6 9.105 6.895 10 8 10C9.105 10 10 9.105 10 8C10 6.895 9.105 6 8 6Z" fill="currentColor"/>
            <line x1="2" y1="2" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>\`;
        
        passwordToggle.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            
            // Update icon and tooltip
            if (isPassword) {
                passwordToggle.innerHTML = eyeOffIcon;
                passwordToggle.title = 'Hide password';
            } else {
                passwordToggle.innerHTML = eyeIcon;
                passwordToggle.title = 'Show password';
            }
        });

        // Toggle password field visibility based on Can Login checkbox
        function updatePasswordFieldVisibility() {
            const canLoginCheckbox = document.getElementById('canLogin');
            const passwordGroup = document.getElementById('passwordGroup');
            
            if (canLoginCheckbox.checked) {
                passwordGroup.style.display = 'block';
            } else {
                passwordGroup.style.display = 'none';
            }
        }

        // Initialize password field visibility
        updatePasswordFieldVisibility();

        // Add listener to Can Login checkbox
        document.getElementById('canLogin').addEventListener('change', () => {
            updatePasswordFieldVisibility();
            updatePreview();
        });

        function updateRoleTypeUI() {
            const roleType = document.getElementById('roleType').value;
            const passwordGroup = document.getElementById('passwordGroup');
            const passwordRequired = document.getElementById('passwordRequired');
            const passwordInfo = document.getElementById('passwordInfo');
            const canLoginGroup = document.getElementById('canLoginGroup');
            const canLoginInfo = document.getElementById('canLoginInfo');
            const advancedSettings = document.querySelector('.section-box.collapsible');
            const roleTypeInfo = document.getElementById('roleTypeInfo');
            
            if (roleType === 'neon') {
                // Neon API role: hide password input and advanced options
                passwordGroup.style.display = 'none';
                canLoginGroup.style.display = 'none';
                canLoginInfo.style.display = 'none';
                advancedSettings.style.display = 'none';
                roleTypeInfo.textContent = 'Neon roles are created via API with auto-generated passwords and automatically granted neon_superuser membership (CREATEDB, CREATEROLE, pg_read_all_data, pg_write_all_data, etc.)';
            } else {
                // SQL role: show all options (except password if Can Login is unchecked)
                canLoginGroup.style.display = 'flex';
                canLoginInfo.style.display = 'block';
                advancedSettings.style.display = 'block';
                roleTypeInfo.textContent = 'SQL roles have basic public schema privileges and must be manually configured with specific permissions for each database object.';
                
                // Update password field visibility based on Can Login state
                updatePasswordFieldVisibility();
            }
            
            updatePreview();
        }
        
        // Initialize UI based on default selection
        updateRoleTypeUI();

        function getUserDefinition() {
            const roleType = document.getElementById('roleType').value;
            return {
                roleType: roleType,
                username: document.getElementById('username').value.trim(),
                password: document.getElementById('password').value,
                canLogin: roleType === 'neon' ? true : document.getElementById('canLogin').checked,
                isSuperuser: false, // Handled by neon_superuser role membership
                canCreateDb: roleType === 'neon' ? false : document.getElementById('canCreateDb').checked,
                canCreateRole: roleType === 'neon' ? false : document.getElementById('canCreateRole').checked,
                connectionLimit: roleType === 'neon' ? -1 : parseInt(document.getElementById('connectionLimit').value),
                validUntil: roleType === 'neon' ? '' : document.getElementById('validUntil').value,
                memberOf: roleType === 'neon' ? [] : selectedRoles
            };
        }

        function validateUser() {
            clearError();
            
            const roleType = document.getElementById('roleType').value;
            const username = document.getElementById('username').value.trim();
            if (!username) {
                showError('Username is required');
                return false;
            }
            
            if (!/^[a-z_][a-z0-9_]*$/i.test(username)) {
                showError('Username must start with a letter and contain only letters, numbers, and underscores');
                return false;
            }
            
            // Skip password validation for Neon roles (auto-generated by API)
            if (roleType === 'neon') {
                return true;
            }
            
            const canLogin = document.getElementById('canLogin').checked;
            const password = document.getElementById('password').value;
            if (canLogin && !password) {
                showError('Password is required for users that can login');
                return false;
            }
            
            // Validate password strength if a password is provided (Neon's requirements)
            if (password) {
                if (password.length < 8) {
                    showError('Password must be at least 8 characters long');
                    return false;
                }
                
                const hasUpperCase = /[A-Z]/.test(password);
                const hasLowerCase = /[a-z]/.test(password);
                const hasNumber = /[0-9]/.test(password);
                const hasSpecialChar = /[!@#$%^&*()_+\\-=\\[\\]{};':"\\\\|,.<>\\/?]/.test(password);
                
                // Neon requires strong passwords - check for all character types
                const missing = [];
                if (!hasUpperCase) missing.push('uppercase letters');
                if (!hasLowerCase) missing.push('lowercase letters');
                if (!hasNumber) missing.push('numbers');
                if (!hasSpecialChar) missing.push('special characters');
                
                if (missing.length > 1) {
                    showError('Password must include ' + missing.join(', '));
                    return false;
                }
                
                // Recommend longer passwords for maximum security
                if (password.length < 10 && missing.length === 1) {
                    showError('Password is too simple. Either use a longer password (10+ characters) or include ' + missing[0]);
                    return false;
                }
            }
            
            return true;
        }

        function toggleSection(sectionId) {
            const content = document.getElementById(sectionId + 'Content');
            const icon = document.getElementById(sectionId + 'Icon');
            if (content.style.display === 'none') {
                content.style.display = 'block';
                icon.textContent = '▼';
            } else {
                content.style.display = 'none';
                icon.textContent = '▶';
            }
        }

        function updatePreview() {
            vscode.postMessage({
                command: 'previewSql',
                userDef: getUserDefinition()
            });
        }

        // Add event listeners for auto-updating preview
        document.getElementById('username').addEventListener('input', updatePreview);
        document.getElementById('password').addEventListener('input', updatePreview);
        document.getElementById('canCreateDb').addEventListener('change', updatePreview);
        document.getElementById('canCreateRole').addEventListener('change', updatePreview);
        document.getElementById('connectionLimit').addEventListener('input', updatePreview);
        document.getElementById('validUntil').addEventListener('change', updatePreview);

        document.getElementById('createBtn').addEventListener('click', () => {
            if (!validateUser()) return;
            vscode.postMessage({
                command: 'createUser',
                userDef: getUserDefinition()
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

        // Generate initial preview
        updatePreview();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for manage permissions panel
     */
    private static getManagePermissionsHtml(
        username: string,
        permissions: any[],
        dbPermissions: any[],
        schemas: string[]
    ): string {
        const permsJson = JSON.stringify(permissions);
        const dbPermsJson = JSON.stringify(dbPermissions);
        const schemasJson = JSON.stringify(schemas);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Manage Permissions</title>
    ${getStyles()}
    <style>
        /* Override max-width for permissions page */
        .container {
            max-width: none;
        }
        
        .table-wrapper {
            overflow-x: auto;
            margin-top: 12px;
        }
        
        .permissions-table {
            width: 100%;
            border-collapse: collapse;
        }
        
        .permissions-table th,
        .permissions-table td {
            padding: 8px 12px;
            text-align: left;
            border-bottom: 1px solid var(--vscode-widget-border);
            white-space: nowrap;
        }
        
        .permissions-table th {
            font-weight: 600;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-foreground);
        }
        
        .permissions-table tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        
        .btn-sm {
            padding: 4px 12px;
            font-size: 12px;
        }
        
        .btn-danger {
            background-color: var(--vscode-errorForeground);
            color: var(--vscode-button-foreground);
        }
        
        .btn-danger:hover {
            opacity: 0.9;
        }
        
        .no-permissions {
            padding: 16px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
            <h1 style="margin: 0;">Permissions: ${username}</h1>
            <button class="btn" id="addPermissionBtn" style="padding: 6px 16px; margin: 0;">Add Permissions</button>
        </div>
        
        <div id="errorContainer"></div>

            <div id="currentPermissions"></div>
        </div>

    <script>
        const vscode = acquireVsCodeApi();
        let permissions = ${permsJson};
        let dbPermissions = ${dbPermsJson};
        const schemas = ${schemasJson};

        // Add Permissions button handler
        document.getElementById('addPermissionBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'openAddPermissions',
                schemas: schemas
            });
        });

        function renderCurrentPermissions() {
            const container = document.getElementById('currentPermissions');
            if (permissions.length === 0 && dbPermissions.length === 0) {
                container.innerHTML = '<div class="no-permissions">No permissions granted yet</div>';
                return;
            }

            let html = '<div class="table-wrapper">';
            html += '<table class="permissions-table">';
            html += '<thead><tr>';
            html += '<th>Type</th>';
            html += '<th>Object</th>';
            html += '<th>Privileges</th>';
            html += '<th style="width: 100px;">Actions</th>';
            html += '</tr></thead><tbody>';
            
            // Add database permissions
            dbPermissions.forEach(perm => {
                html += '<tr>';
                html += '<td>Database</td>';
                html += \`<td>\${perm.database_name}</td>\`;
                html += \`<td>\${Array.isArray(perm.privileges) ? perm.privileges.filter(p => p).join(', ') : 'N/A'}</td>\`;
                html += '<td><button class="btn btn-danger btn-sm" onclick="revokeDbPermission(\\'' + perm.database_name + '\\')">Revoke</button></td>';
                html += '</tr>';
            });
            
            // Add table/object permissions
            permissions.forEach(perm => {
                const objectType = perm.object_type === 'r' ? 'Table' : 
                                   perm.object_type === 'v' ? 'View' : 
                                   perm.object_type === 'S' ? 'Sequence' : 'Object';
                html += '<tr>';
                html += \`<td>\${objectType}</td>\`;
                html += \`<td>\${perm.schema_name}.\${perm.table_name}</td>\`;
                html += \`<td>\${Array.isArray(perm.privileges) ? perm.privileges.join(', ') : perm.privileges}</td>\`;
                html += '<td><button class="btn btn-danger btn-sm" onclick="revokePermission(\\'' + perm.schema_name + '\\', \\'' + perm.table_name + '\\')">Revoke</button></td>';
                html += '</tr>';
            });
            
            html += '</tbody></table>';
            html += '</div>';
            container.innerHTML = html;
        }

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'success':
                    clearError();
                    showSuccess('Operation completed successfully');
                    break;
                case 'error':
                    showError(message.error);
                    break;
                case 'refreshPermissions':
                    clearError();
                    showSuccess('Operation completed successfully');
                    // Update the permissions data
                    permissions = message.permissions;
                    dbPermissions = message.dbPermissions;
                    // Re-render the table
                    renderCurrentPermissions();
                    break;
            }
        });

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
        }

        function showSuccess(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="success">\${message}</div>\`;
        }

        function clearError() {
            document.getElementById('errorContainer').innerHTML = '';
        }

        window.revokePermission = function(schema, table) {
            vscode.postMessage({
                command: 'confirmRevoke',
                revoke: {
                    schema: schema,
                    objectType: 'table',
                    objectName: table,
                    privileges: ['ALL']
                },
                confirmMessage: \`Revoke all permissions on \${schema}.\${table}?\`
            });
        };

        window.revokeDbPermission = function(database) {
            vscode.postMessage({
                command: 'confirmRevoke',
                revoke: {
                    schema: '',
                    objectType: 'database',
                    objectName: database,
                    privileges: ['ALL']
                },
                confirmMessage: \`Revoke all database privileges on \${database}?\`
            });
        };

        renderCurrentPermissions();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for add permissions panel (child page with breadcrumbs)
     */
    private static getAddPermissionsHtml(username: string, schemas: string[]): string {
        const schemasJson = JSON.stringify(schemas);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Add Permissions</title>
    ${getStyles()}
    <style>
        .breadcrumb {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 24px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .breadcrumb-item {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .breadcrumb-link {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            cursor: pointer;
        }
        
        .breadcrumb-link:hover {
            text-decoration: underline;
        }
        
        .breadcrumb-separator {
            color: var(--vscode-descriptionForeground);
        }
        
        .breadcrumb-current {
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="breadcrumb">
            <div class="breadcrumb-item">
                <a href="#" class="breadcrumb-link" id="backToPermissions">Permissions: ${username}</a>
            </div>
            <span class="breadcrumb-separator">›</span>
            <div class="breadcrumb-item">
                <span class="breadcrumb-current">Add Permissions</span>
            </div>
        </div>

        <h1>Add Permissions for ${username}</h1>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <div class="form-group">
                <label>Schema <span class="required">*</span></label>
                <select id="grantSchema">
                    <option value="">Select schema...</option>
                </select>
                <div class="info-text">Select the schema where permissions will be granted</div>
            </div>

            <div class="form-group">
                <label>Object Type <span class="required">*</span></label>
                <select id="grantObjectType">
                    <option value="table">Tables (all tables in schema)</option>
                    <option value="schema">Schema</option>
                    <option value="sequence">Sequences (all sequences in schema)</option>
                    <option value="function">Functions (all functions in schema)</option>
                </select>
                <div class="info-text">Type of database object to grant permissions on</div>
            </div>

            <div class="form-group">
                <label>Privileges <span class="required">*</span></label>
                <div id="privilegesList"></div>
                <div class="info-text">Select one or more privileges to grant</div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="grantOption" />
                <label for="grantOption" style="margin: 0;">With Grant Option</label>
            </div>
            <div class="info-text" style="margin-top: 4px;">Allow the role to grant these privileges to others</div>

            <div class="checkbox-group" style="margin-top: 12px;">
                <input type="checkbox" id="applyToFuture" checked />
                <label for="applyToFuture" style="margin: 0;">Apply to future objects</label>
            </div>
            <div class="info-text" style="margin-top: 4px;">Also grant these privileges to objects created in the future (uses ALTER DEFAULT PRIVILEGES)</div>
        </div>

        <div class="actions">
            <button class="btn" id="grantBtn">Grant Permissions</button>
            <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const schemas = ${schemasJson};

        // Populate schemas
        const schemaSelect = document.getElementById('grantSchema');
        schemas.forEach(schema => {
            const option = document.createElement('option');
            option.value = schema;
            option.textContent = schema;
            schemaSelect.appendChild(option);
        });

        function updatePrivilegesList() {
            const objectType = document.getElementById('grantObjectType').value;
            const privilegesList = document.getElementById('privilegesList');
            privilegesList.innerHTML = '';

            let availablePrivileges = [];
            if (objectType === 'table') {
                availablePrivileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
            } else if (objectType === 'schema') {
                availablePrivileges = ['USAGE', 'CREATE'];
            } else if (objectType === 'sequence') {
                availablePrivileges = ['USAGE', 'SELECT', 'UPDATE'];
            } else if (objectType === 'function') {
                availablePrivileges = ['EXECUTE'];
            }

            availablePrivileges.forEach(priv => {
                const div = document.createElement('div');
                div.className = 'checkbox-group';
                div.innerHTML = \`
                    <input type="checkbox" id="priv_\${priv}" value="\${priv}" />
                    <label for="priv_\${priv}" style="margin: 0;">\${priv}</label>
                \`;
                privilegesList.appendChild(div);
            });
        }

        document.getElementById('grantObjectType').addEventListener('change', updatePrivilegesList);

        document.getElementById('grantBtn').addEventListener('click', () => {
            const schema = document.getElementById('grantSchema').value;
            if (!schema) {
                showError('Please select a schema');
                return;
            }

            const objectType = document.getElementById('grantObjectType').value;
            const privileges = Array.from(document.querySelectorAll('#privilegesList input:checked'))
                .map(cb => cb.value);
            
            if (privileges.length === 0) {
                showError('Please select at least one privilege');
                return;
            }

            const grantOption = document.getElementById('grantOption').checked;
            const applyToFuture = document.getElementById('applyToFuture').checked;

            vscode.postMessage({
                command: 'grantPermission',
                grant: {
                    schema: schema,
                    objectType: objectType,
                    objectName: '*',
                    privileges: privileges,
                    grantOption: grantOption,
                    applyToFuture: applyToFuture
                }
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'cancel' });
        });

        document.getElementById('backToPermissions').addEventListener('click', (e) => {
            e.preventDefault();
            vscode.postMessage({ command: 'cancel' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'success':
                    clearError();
                    showSuccess('Operation completed successfully');
                    break;
                case 'error':
                    showError(message.error);
                    break;
            }
        });

        function showError(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="error">\${message}</div>\`;
        }

        function showSuccess(message) {
            document.getElementById('errorContainer').innerHTML = \`<div class="success">\${message}</div>\`;
        }

        function clearError() {
            document.getElementById('errorContainer').innerHTML = '';
        }

        updatePrivilegesList();
    </script>
</body>
</html>`;
    }
}


