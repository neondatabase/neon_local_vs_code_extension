import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';
import { getStyles } from '../templates/styles';
import { NeonApiService } from '../services/api.service';

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
    members?: Array<{ role: string; admin: boolean }>;
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
    /**
     * Get the first available database from the branch connection info
     * Roles are cluster-wide, so we can connect to any database to query them
     */
    private static async getAvailableDatabase(stateService: StateService, requestedDatabase?: string): Promise<string> {
        const viewData = await stateService.getViewData();
        const branchConnectionInfos = viewData.connection.branchConnectionInfos;
        
        if (!branchConnectionInfos || branchConnectionInfos.length === 0) {
            throw new Error('No connection information available. Please reconnect.');
        }
        
        // If a specific database is requested and exists, use it
        if (requestedDatabase) {
            const found = branchConnectionInfos.find(info => info.database === requestedDatabase);
            if (found) {
                return requestedDatabase;
            }
        }
        
        // Otherwise use the first available database
        return branchConnectionInfos[0].database;
    }

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
            
            // Get all users/roles - users are global, so use any available database from the branch
            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);
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
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        UserManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            UserManagementPanel.currentPanels.delete(key);
        });

        try {
            // Get existing roles for membership - users are global, so use any available database from the branch
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname
                FROM pg_catalog.pg_roles
                WHERE rolname !~ '^pg_'
                  AND rolname NOT IN ('cloud_admin', 'neon_service')
                ORDER BY rolname
            `, targetDb);

            const initialData = {
                existingRoles: rolesResult.rows.map(r => r.rolname)
            };

            panel.webview.html = UserManagementPanel.getWebviewContent(context, panel, initialData);

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
            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);
            
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
                panel.webview,
                context.extensionUri,
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
            panel.webview.html = UserManagementPanel.getAddPermissionsHtml(
                panel.webview,
                context.extensionUri,
                username,
                schemas
            );

            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'getObjects':
                        // Fetch available objects for the selected schema and object type
                        await UserManagementPanel.fetchObjects(
                            context,
                            stateService,
                            message.schema,
                            message.objectType,
                            targetDb,
                            panel
                        );
                        break;
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
            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);
            await sqlService.executeQuery(sql, targetDb);

            vscode.window.showInformationMessage(`User/role "${username}" dropped successfully!`);
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to drop user: ${errorMessage}`);
            throw error;
        }
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
                let projectId: string | undefined;
                let branchId: string | undefined;
                
                try {
                    projectId = await stateService.getCurrentProjectId();
                    branchId = await stateService.getCurrentBranchId();
                } catch (error) {
                    console.log('getCurrentProjectId/Branch failed:', error);
                }
                
                if (!projectId || !branchId) {
                    try {
                        const viewData = await stateService.getViewData();
                        projectId = projectId || viewData.connection?.selectedProjectId;
                        branchId = branchId || viewData.connection?.selectedBranchId || viewData.connection?.currentlyConnectedBranch;
                    } catch (error) {
                        console.log('getViewData failed:', error);
                    }
                }
                
                if (!projectId || !branchId) {
                    panel.webview.postMessage({
                        command: 'error',
                        error: 'Unable to determine project or branch. Neon roles can only be created when connected. Create a SQL role instead.'
                    });
                    return;
                }
                
                const response = await apiService.createRole(projectId, branchId, userDef.username);
                const password = response.role.password || '(password not provided)';
                await vscode.env.clipboard.writeText(password);
                vscode.window.showInformationMessage(
                    `Neon role "${userDef.username}" created. Password copied to clipboard: ${password}`
                );
                
                await vscode.commands.executeCommand('neonLocal.schema.refresh');
                panel.dispose();
            } else {
                // Create role via SQL
                const sql = UserManagementPanel.generateCreateUserSql(userDef);
                const sqlService = new SqlQueryService(stateService, context);
                await sqlService.executeQuery(sql, database);

                vscode.window.showInformationMessage(`SQL role "${userDef.username}" created successfully!`);
                await vscode.commands.executeCommand('neonLocal.schema.refresh');
                panel.dispose();
            }
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            console.error('Create user error:', errorMessage);
            
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
            memberOf,
            members
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
        
        if (connectionLimit && connectionLimit >= 0) {
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
        
        // Add members
        if (members && members.length > 0) {
            members.forEach(member => {
                const adminOption = member.admin ? ' WITH ADMIN OPTION' : '';
                sql += `\nGRANT ${username} TO ${member.role}${adminOption};`;
            });
        }
        
        return sql;
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
            const errorMessage = this.extractErrorMessage(error);
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
            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);
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
            window.scrollTo({ top: 0, behavior: 'smooth' });
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
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        try {
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);

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
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser', 'neon_service', $1)
                ORDER BY rolname
            `, [roleName], targetDb);
            const existingRoles = rolesResult.rows.map((row: any) => row.rolname);

            // Add neon_superuser back to the list for membership
            existingRoles.push('neon_superuser');
            existingRoles.sort();

            // Fetch current members of this role (roles that are members of this role)
            const membersResult = await sqlService.executeQuery(`
                SELECT 
                    r.rolname,
                    am.admin_option
                FROM pg_catalog.pg_auth_members am
                JOIN pg_catalog.pg_roles r ON r.oid = am.member
                WHERE am.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
                ORDER BY r.rolname
            `, [roleName], targetDb);
            const currentMembers = membersResult.rows.map((row: any) => ({
                role: row.rolname,
                admin: row.admin_option
            }));

            const initialData = {
                roleName,
                currentRole: {
                    can_login: currentRole.can_login,
                    can_create_db: currentRole.can_create_db,
                    can_create_role: currentRole.can_create_role,
                    connection_limit: currentRole.connection_limit,
                    valid_until: currentRole.valid_until
                },
                currentMemberOf: memberOfArray,
                existingRoles,
                currentMembers
            };

            panel.webview.html = UserManagementPanel.getEditWebviewContent(context, panel, initialData);

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'editRole':
                        await UserManagementPanel.executeEditRole(
                            context,
                            stateService,
                            roleName,
                            message.changes,
                            targetDb,
                            panel
                        );
                        break;
                    case 'previewEditSql':
                        const sql = UserManagementPanel.generateEditRoleSql(roleName, message.changes);
                        panel.webview.postMessage({ command: 'sqlPreview', sql });
                        break;
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            });

        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
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
            
            // Handle members changes (roles that are members of this role)
            if (userDef.members && Array.isArray(userDef.members)) {
                // Get current members of this role
                const currentMembersResult = await sqlService.executeQuery(`
                    SELECT 
                        r.rolname,
                        am.admin_option
                    FROM pg_catalog.pg_auth_members am
                    JOIN pg_catalog.pg_roles r ON r.oid = am.member
                    WHERE am.roleid = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = $1)
                `, [currentRoleName], database);
                
                const currentMembers = currentMembersResult.rows.map((row: any) => ({
                    role: row.rolname,
                    admin: row.admin_option
                }));
                
                // Revoke removed members
                for (const currentMember of currentMembers) {
                    const stillMember = userDef.members.find((m: any) => m.role === currentMember.role);
                    if (!stillMember) {
                        await sqlService.executeQuery(`REVOKE "${currentRoleName}" FROM "${currentMember.role}"`, database);
                    }
                }
                
                // Grant new members or update admin option
                for (const newMember of userDef.members) {
                    const currentMember = currentMembers.find((m: any) => m.role === newMember.role);
                    
                    if (!currentMember) {
                        // New member - grant
                        const adminOption = newMember.admin ? ' WITH ADMIN OPTION' : '';
                        await sqlService.executeQuery(`GRANT "${currentRoleName}" TO "${newMember.role}"${adminOption}`, database);
                    } else if (currentMember.admin !== newMember.admin) {
                        // Admin option changed - revoke and re-grant
                        await sqlService.executeQuery(`REVOKE "${currentRoleName}" FROM "${newMember.role}"`, database);
                        const adminOption = newMember.admin ? ' WITH ADMIN OPTION' : '';
                        await sqlService.executeQuery(`GRANT "${currentRoleName}" TO "${newMember.role}"${adminOption}`, database);
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

    /**
     * Get webview content for React components (Create User)
     */
    private static getWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'createUser.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create User</title>
    <style>
        body { 
            margin: 0; 
            padding: 0; 
            height: 100vh; 
            overflow: auto; 
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        const vscode = acquireVsCodeApi();
        window.vscode = vscode;
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Get webview content for React components (Edit Role)
     */
    private static getEditWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'editUser.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Role</title>
    <style>
        body { 
            margin: 0; 
            padding: 0; 
            height: 100vh; 
            overflow: auto; 
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        const vscode = acquireVsCodeApi();
        window.vscode = vscode;
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Get HTML for users list (legacy - not refactored to React yet)
     */
    private static getUsersListHtml(users: any[]): string {
        return `<!DOCTYPE html>
<html><head><title>Users List</title></head>
<body><h1>Users List</h1><p>This panel hasn't been refactored to React yet.</p></body>
</html>`;
    }

    /**
     * Get HTML for manage permissions (legacy - not refactored to React yet)
     */
    private static getManagePermissionsHtml(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
        username: string,
        permissions: any[],
        dbPermissions: any[],
        schemas: string[]
    ): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'managePermissions.js'));
        const initialData = {
            username,
            permissions,
            dbPermissions,
            schemas
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">
    <title>Manage Permissions: ${username}</title>
    <style>
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        window.vscode = acquireVsCodeApi();
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Get HTML for add permissions
     */
    private static getAddPermissionsHtml(
        webview: vscode.Webview,
        extensionUri: vscode.Uri,
        username: string,
        schemas: string[]
    ): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'addPermissions.js'));
        const initialData = {
            username,
            schemas
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource} 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">
    <title>Add Permissions: ${username}</title>
    <style>
        body {
            padding: 0;
            margin: 0;
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        window.vscode = acquireVsCodeApi();
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }

    /**
     * Fetch available objects for a schema and object type
     */
    private static async fetchObjects(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        objectType: string,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            let query = '';
            
            switch (objectType) {
                case 'table':
                    query = `
                        SELECT tablename as name
                        FROM pg_tables
                        WHERE schemaname = $1
                        ORDER BY tablename
                    `;
                    break;
                case 'sequence':
                    query = `
                        SELECT sequencename as name
                        FROM pg_sequences
                        WHERE schemaname = $1
                        ORDER BY sequencename
                    `;
                    break;
                case 'function':
                    query = `
                        SELECT p.proname as name
                        FROM pg_proc p
                        JOIN pg_namespace n ON p.pronamespace = n.oid
                        WHERE n.nspname = $1
                        ORDER BY p.proname
                    `;
                    break;
                default:
                    query = `
                        SELECT tablename as name
                        FROM pg_tables
                        WHERE schemaname = $1
                        ORDER BY tablename
                    `;
            }

            const result = await sqlService.executeQuery(query, [schema], database);
            const objects = result.rows.map((row: any) => row.name);

            panel.webview.postMessage({
                command: 'updateObjects',
                objects
            });
        } catch (error) {
            console.error('Error fetching objects:', error);
            vscode.window.showErrorMessage(`Failed to fetch objects: ${error}`);
        }
    }

    /**
     * Execute grant permission
     */
    private static async executeGrantPermission(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        grant: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            const privileges = grant.privileges.join(', ');
            const grantOptionSql = grant.grantOption ? ' WITH GRANT OPTION' : '';
            let sql = '';

            switch (grant.objectType) {
                case 'table':
                    sql = `GRANT ${privileges} ON TABLE "${grant.schema}"."${grant.objectName}" TO "${username}"${grantOptionSql}`;
                    await sqlService.executeQuery(sql, [], database);
                    
                    // If apply to future is checked, also add default privileges
                    if (grant.applyToFuture) {
                        const futureSQL = `ALTER DEFAULT PRIVILEGES IN SCHEMA "${grant.schema}" GRANT ${privileges} ON TABLES TO "${username}"${grantOptionSql}`;
                        await sqlService.executeQuery(futureSQL, [], database);
                    }
                    break;
                case 'schema':
                    sql = `GRANT ${privileges} ON SCHEMA "${grant.schema}" TO "${username}"${grantOptionSql}`;
                    await sqlService.executeQuery(sql, [], database);
                    break;
                case 'database':
                    const dbName = grant.database || database || 'current';
                    sql = `GRANT ${privileges} ON DATABASE "${dbName}" TO "${username}"`;
                    await sqlService.executeQuery(sql, [], database);
                    break;
                case 'sequence':
                    sql = `GRANT ${privileges} ON SEQUENCE "${grant.schema}"."${grant.objectName}" TO "${username}"${grantOptionSql}`;
                    await sqlService.executeQuery(sql, [], database);
                    break;
                case 'function':
                    sql = `GRANT ${privileges} ON FUNCTION "${grant.schema}"."${grant.objectName}" TO "${username}"${grantOptionSql}`;
                    await sqlService.executeQuery(sql, [], database);
                    break;
            }

            vscode.window.showInformationMessage(`Permissions granted successfully to ${username}`);

            // Refresh the parent panel
            await this.refreshPermissionsPanel(context, stateService, username, database, panel);
        } catch (error) {
            console.error('Error granting permission:', error);
            vscode.window.showErrorMessage(`Failed to grant permission: ${error}`);
        }
    }

    /**
     * Execute revoke permission
     */
    private static async executeRevokePermission(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        revoke: any,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            const privileges = revoke.privileges.join(', ');
            let sql = '';

            if (revoke.databaseName) {
                // Database-level revoke
                sql = `REVOKE ${privileges} ON DATABASE "${revoke.databaseName}" FROM "${username}"`;
            } else if (revoke.objectType === 'r') {
                // Table revoke
                sql = `REVOKE ${privileges} ON TABLE "${revoke.schema}"."${revoke.objectName}" FROM "${username}"`;
            } else if (revoke.objectType === 'v' || revoke.objectType === 'm') {
                // View revoke
                sql = `REVOKE ${privileges} ON TABLE "${revoke.schema}"."${revoke.objectName}" FROM "${username}"`;
            } else if (revoke.objectType === 'S') {
                // Sequence revoke
                sql = `REVOKE ${privileges} ON SEQUENCE "${revoke.schema}"."${revoke.objectName}" FROM "${username}"`;
            } else if (revoke.objectType === 'f') {
                // Function revoke
                sql = `REVOKE ${privileges} ON FUNCTION "${revoke.schema}"."${revoke.objectName}" FROM "${username}"`;
            }

            await sqlService.executeQuery(sql, [], database);
            vscode.window.showInformationMessage(`Permissions revoked successfully from ${username}`);

            // Refresh the panel
            await this.refreshPermissionsPanel(context, stateService, username, database, panel);
        } catch (error) {
            console.error('Error revoking permission:', error);
            vscode.window.showErrorMessage(`Failed to revoke permission: ${error}`);
        }
    }

    /**
     * Refresh the permissions panel with updated data
     */
    private static async refreshPermissionsPanel(
        context: vscode.ExtensionContext,
        stateService: StateService,
        username: string,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            const targetDb = await UserManagementPanel.getAvailableDatabase(stateService, database);

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

            panel.webview.postMessage({
                command: 'refreshPermissions',
                permissions: permsResult.rows,
                dbPermissions: dbPermsResult.rows
            });
        } catch (error) {
            console.error('Error refreshing permissions:', error);
        }
    }
}


