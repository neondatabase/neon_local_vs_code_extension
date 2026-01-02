import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { SqlQueryService } from '../services/sqlQuery.service';
import { getStyles } from '../templates/styles';

export class ObjectPermissionsPanel {
    private static extractErrorMessage(error: any): string {
        if (error && typeof error === 'object' && 'message' in error) {
            return error.message;
        }
        if (error instanceof Error) {
            return error.message;
        }
        if (typeof error === 'string') {
            return error;
        }
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    private static currentPanels: Map<string, vscode.WebviewPanel> = new Map();

    /**
     * Manage permissions for a database object
     */
    public static async manageObjectPermissions(
        context: vscode.ExtensionContext,
        stateService: StateService,
        objectType: 'TABLE' | 'VIEW' | 'FUNCTION' | 'SEQUENCE' | 'SCHEMA',
        objectName: string,
        schema: string,
        database?: string
    ): Promise<void> {
        const key = `permissions_${database || 'default'}.${schema}.${objectName}`;
        
        if (ObjectPermissionsPanel.currentPanels.has(key)) {
            ObjectPermissionsPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'manageObjectPermissions',
            `Permissions: ${schema}.${objectName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ObjectPermissionsPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            ObjectPermissionsPanel.currentPanels.delete(key);
        });

        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // Get available roles
            const rolesResult = await sqlService.executeQuery(`
                SELECT rolname 
                FROM pg_roles 
                WHERE rolname NOT LIKE 'pg_%'
                  AND rolname NOT IN ('cloud_admin', 'neon_superuser')
                ORDER BY rolname
            `, [], database);

            // Get current permissions
            const permissions = await ObjectPermissionsPanel.getCurrentPermissions(
                sqlService,
                objectType,
                objectName,
                schema,
                database
            );

            panel.webview.html = ObjectPermissionsPanel.getPermissionsHtml(
                objectType,
                objectName,
                schema,
                rolesResult.rows,
                permissions
            );

            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'openGrantPermission':
                        await ObjectPermissionsPanel.openGrantPermissionPanel(
                            context,
                            stateService,
                            objectType,
                            objectName,
                            schema,
                            database,
                            rolesResult.rows,
                            panel
                        );
                        break;
                    case 'openEditPermission':
                        await ObjectPermissionsPanel.openEditPermissionPanel(
                            context,
                            stateService,
                            objectType,
                            objectName,
                            schema,
                            database,
                            rolesResult.rows,
                            message.grantee,
                            message.currentPermissions,
                            panel
                        );
                        break;
                    case 'confirmRevoke':
                        // Show confirmation dialog in VS Code
                        const privilegeList = message.privileges.join(', ');
                        const confirmation = await vscode.window.showWarningMessage(
                            `Are you sure you want to revoke all permissions for grantee "${message.grantee}"?`,
                            { modal: true, detail: `This will revoke: ${privilegeList}` },
                            'Revoke'
                        );
                        
                        if (confirmation === 'Revoke') {
                            await ObjectPermissionsPanel.executeRevokePermission(
                                context,
                                stateService,
                                objectType,
                                objectName,
                                schema,
                                message.grantee,
                                message.privileges,
                                database,
                                panel
                            );
                        }
                        break;
                    case 'refresh':
                        const refreshedPermissions = await ObjectPermissionsPanel.getCurrentPermissions(
                            sqlService,
                            objectType,
                            objectName,
                            schema,
                            database
                        );
                        panel.webview.postMessage({
                            command: 'updatePermissions',
                            permissions: refreshedPermissions
                        });
                        break;
                }
            });

        } catch (error) {
            const errorMessage = ObjectPermissionsPanel.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to load permissions: ${errorMessage}`);
            panel.dispose();
        }
    }

    /**
     * Open grant permission panel
     */
    private static async openGrantPermissionPanel(
        context: vscode.ExtensionContext,
        stateService: StateService,
        objectType: 'TABLE' | 'VIEW' | 'FUNCTION' | 'SEQUENCE' | 'SCHEMA',
        objectName: string,
        schema: string,
        database: string | undefined,
        roles: any[],
        parentPanel: vscode.WebviewPanel
    ): Promise<void> {
        const grantPanel = vscode.window.createWebviewPanel(
            'grantObjectPermissions',
            `Grant Permissions: ${schema}.${objectName}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const availablePrivileges = ObjectPermissionsPanel.getAvailablePrivileges(objectType);
        grantPanel.webview.html = ObjectPermissionsPanel.getGrantPermissionHtml(
            objectType,
            objectName,
            schema,
            roles,
            availablePrivileges
        );

        grantPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'grantPermission':
                    await ObjectPermissionsPanel.executeGrantPermissionFromChild(
                        context,
                        stateService,
                        objectType,
                        objectName,
                        schema,
                        message.grantee,
                        message.privileges,
                        message.withGrantOption,
                        database,
                        grantPanel,
                        parentPanel
                    );
                    break;
                case 'cancel':
                    grantPanel.dispose();
                    break;
            }
        });
    }

    /**
     * Open edit permission panel
     */
    private static async openEditPermissionPanel(
        context: vscode.ExtensionContext,
        stateService: StateService,
        objectType: 'TABLE' | 'VIEW' | 'FUNCTION' | 'SEQUENCE' | 'SCHEMA',
        objectName: string,
        schema: string,
        database: string | undefined,
        roles: any[],
        grantee: string,
        currentPermissions: any[],
        parentPanel: vscode.WebviewPanel
    ): Promise<void> {
        const editPanel = vscode.window.createWebviewPanel(
            'editObjectPermissions',
            `Edit Permissions: ${grantee}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        const availablePrivileges = ObjectPermissionsPanel.getAvailablePrivileges(objectType);
        editPanel.webview.html = ObjectPermissionsPanel.getEditPermissionHtml(
            objectType,
            objectName,
            schema,
            grantee,
            currentPermissions,
            availablePrivileges
        );

        editPanel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'updatePermission':
                    await ObjectPermissionsPanel.executeUpdatePermission(
                        context,
                        stateService,
                        objectType,
                        objectName,
                        schema,
                        grantee,
                        message.privileges,
                        currentPermissions,
                        database,
                        editPanel,
                        parentPanel
                    );
                    break;
                case 'cancel':
                    editPanel.dispose();
                    break;
            }
        });
    }

    /**
     * Get current permissions for an object
     */
    private static async getCurrentPermissions(
        sqlService: SqlQueryService,
        objectType: string,
        objectName: string,
        schema: string,
        database?: string
    ): Promise<any[]> {
        let query = '';
        let params: any[] = [];
        
        switch (objectType) {
            case 'TABLE':
            case 'VIEW':
                query = `
                    SELECT 
                        grantee,
                        privilege_type,
                        is_grantable,
                        grantor
                    FROM information_schema.table_privileges
                    WHERE table_schema = $1 AND table_name = $2
                    ORDER BY grantee, privilege_type
                `;
                params = [schema, objectName];
                break;
            case 'FUNCTION':
                query = `
                    SELECT 
                        grantee,
                        privilege_type,
                        is_grantable
                    FROM information_schema.routine_privileges
                    WHERE routine_schema = $1 AND routine_name = $2
                    ORDER BY grantee, privilege_type
                `;
                params = [schema, objectName];
                break;
            case 'SEQUENCE':
                query = `
                    SELECT 
                        grantee,
                        privilege_type,
                        is_grantable
                    FROM information_schema.usage_privileges
                    WHERE object_schema = $1 AND object_name = $2
                    ORDER BY grantee, privilege_type
                `;
                params = [schema, objectName];
                break;
            case 'SCHEMA':
                // For schemas, query the system catalog
                // Handle both explicit ACLs and default permissions (NULL ACLs)
                query = `
                    SELECT 
                        COALESCE(r.rolname, 'PUBLIC') as grantee,
                        a.privilege_type,
                        CASE WHEN a.is_grantable THEN 'YES' ELSE 'NO' END as is_grantable,
                        grantor.rolname as grantor
                    FROM pg_namespace n
                    CROSS JOIN LATERAL (
                        SELECT * FROM aclexplode(
                            CASE 
                                WHEN n.nspacl IS NULL THEN acldefault('n', n.nspowner)
                                ELSE n.nspacl
                            END
                        )
                    ) AS a
                    LEFT JOIN pg_roles r ON r.oid = a.grantee
                    LEFT JOIN pg_roles grantor ON grantor.oid = a.grantor
                    WHERE n.nspname = $1
                    ORDER BY grantee, privilege_type
                `;
                params = [schema];
                break;
        }

        const result = await sqlService.executeQuery(query, params, database);
        return result.rows;
    }

    /**
     * Execute GRANT statement from child panel
     */
    private static async executeGrantPermissionFromChild(
        context: vscode.ExtensionContext,
        stateService: StateService,
        objectType: string,
        objectName: string,
        schema: string,
        grantee: string,
        privileges: string[],
        withGrantOption: boolean,
        database: string | undefined,
        grantPanel: vscode.WebviewPanel,
        parentPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            const privilegeList = privileges.join(', ');
            const grantOption = withGrantOption ? ' WITH GRANT OPTION' : '';
            
            let sql = '';
            switch (objectType) {
                case 'TABLE':
                case 'VIEW':
                    sql = `GRANT ${privilegeList} ON ${objectType} "${schema}"."${objectName}" TO "${grantee}"${grantOption}`;
                    break;
                case 'FUNCTION':
                    sql = `GRANT ${privilegeList} ON FUNCTION "${schema}"."${objectName}" TO "${grantee}"${grantOption}`;
                    break;
                case 'SEQUENCE':
                    sql = `GRANT ${privilegeList} ON SEQUENCE "${schema}"."${objectName}" TO "${grantee}"${grantOption}`;
                    break;
                case 'SCHEMA':
                    sql = `GRANT ${privilegeList} ON SCHEMA "${schema}" TO "${grantee}"${grantOption}`;
                    break;
            }

            await sqlService.executeQuery(sql, [], database);
            
            vscode.window.showInformationMessage(`Permissions granted successfully!`);
            
            // Refresh permissions display on parent panel
            const refreshedPermissions = await ObjectPermissionsPanel.getCurrentPermissions(
                sqlService,
                objectType,
                objectName,
                schema,
                database
            );
            parentPanel.webview.postMessage({
                command: 'updatePermissions',
                permissions: refreshedPermissions
            });
            
            // Close the grant panel
            grantPanel.dispose();
            
        } catch (error) {
            const errorMessage = ObjectPermissionsPanel.extractErrorMessage(error);
            grantPanel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Execute UPDATE permission (revoke old, grant new)
     */
    private static async executeUpdatePermission(
        context: vscode.ExtensionContext,
        stateService: StateService,
        objectType: string,
        objectName: string,
        schema: string,
        grantee: string,
        newPrivileges: Array<{privilege: string; withGrantOption: boolean}>,
        oldPermissions: any[],
        database: string | undefined,
        editPanel: vscode.WebviewPanel,
        parentPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            
            // First, revoke all existing privileges
            const oldPrivilegeTypes = oldPermissions.map(p => p.privilege_type);
            if (oldPrivilegeTypes.length > 0) {
                const revokeList = oldPrivilegeTypes.join(', ');
                let revokeSql = '';
                switch (objectType) {
                    case 'TABLE':
                    case 'VIEW':
                        revokeSql = `REVOKE ${revokeList} ON ${objectType} "${schema}"."${objectName}" FROM "${grantee}"`;
                        break;
                    case 'FUNCTION':
                        revokeSql = `REVOKE ${revokeList} ON FUNCTION "${schema}"."${objectName}" FROM "${grantee}"`;
                        break;
                    case 'SEQUENCE':
                        revokeSql = `REVOKE ${revokeList} ON SEQUENCE "${schema}"."${objectName}" FROM "${grantee}"`;
                        break;
                    case 'SCHEMA':
                        revokeSql = `REVOKE ${revokeList} ON SCHEMA "${schema}" FROM "${grantee}"`;
                        break;
                }
                await sqlService.executeQuery(revokeSql, [], database);
            }

            // Then grant new privileges
            for (const priv of newPrivileges) {
                const grantOption = priv.withGrantOption ? ' WITH GRANT OPTION' : '';
                let grantSql = '';
                switch (objectType) {
                    case 'TABLE':
                    case 'VIEW':
                        grantSql = `GRANT ${priv.privilege} ON ${objectType} "${schema}"."${objectName}" TO "${grantee}"${grantOption}`;
                        break;
                    case 'FUNCTION':
                        grantSql = `GRANT ${priv.privilege} ON FUNCTION "${schema}"."${objectName}" TO "${grantee}"${grantOption}`;
                        break;
                    case 'SEQUENCE':
                        grantSql = `GRANT ${priv.privilege} ON SEQUENCE "${schema}"."${objectName}" TO "${grantee}"${grantOption}`;
                        break;
                    case 'SCHEMA':
                        grantSql = `GRANT ${priv.privilege} ON SCHEMA "${schema}" TO "${grantee}"${grantOption}`;
                        break;
                }
                await sqlService.executeQuery(grantSql, [], database);
            }
            
            vscode.window.showInformationMessage(`Permissions updated successfully!`);
            
            // Refresh permissions display on parent panel
            const refreshedPermissions = await ObjectPermissionsPanel.getCurrentPermissions(
                sqlService,
                objectType,
                objectName,
                schema,
                database
            );
            parentPanel.webview.postMessage({
                command: 'updatePermissions',
                permissions: refreshedPermissions
            });
            
            // Close the edit panel
            editPanel.dispose();
            
        } catch (error) {
            const errorMessage = ObjectPermissionsPanel.extractErrorMessage(error);
            editPanel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Execute REVOKE statement
     */
    private static async executeRevokePermission(
        context: vscode.ExtensionContext,
        stateService: StateService,
        objectType: string,
        objectName: string,
        schema: string,
        grantee: string,
        privileges: string[],
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sqlService = new SqlQueryService(stateService, context);
            const privilegeList = privileges.join(', ');
            
            let sql = '';
            switch (objectType) {
                case 'TABLE':
                case 'VIEW':
                    sql = `REVOKE ${privilegeList} ON ${objectType} "${schema}"."${objectName}" FROM "${grantee}"`;
                    break;
                case 'FUNCTION':
                    sql = `REVOKE ${privilegeList} ON FUNCTION "${schema}"."${objectName}" FROM "${grantee}"`;
                    break;
                case 'SEQUENCE':
                    sql = `REVOKE ${privilegeList} ON SEQUENCE "${schema}"."${objectName}" FROM "${grantee}"`;
                    break;
                case 'SCHEMA':
                    sql = `REVOKE ${privilegeList} ON SCHEMA "${schema}" FROM "${grantee}"`;
                    break;
            }

            await sqlService.executeQuery(sql, [], database);
            
            vscode.window.showInformationMessage(`Permissions revoked successfully!`);
            
            // Refresh permissions display
            const refreshedPermissions = await ObjectPermissionsPanel.getCurrentPermissions(
                sqlService,
                objectType,
                objectName,
                schema,
                database
            );
            panel.webview.postMessage({
                command: 'updatePermissions',
                permissions: refreshedPermissions
            });
            
        } catch (error) {
            const errorMessage = ObjectPermissionsPanel.extractErrorMessage(error);
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Get HTML for permissions panel
     */
    private static getPermissionsHtml(
        objectType: string,
        objectName: string,
        schema: string,
        roles: any[],
        permissions: any[]
    ): string {
        const permissionsJson = JSON.stringify(permissions);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Manage Permissions</title>
    ${getStyles()}
    <style>
        @font-face {
            font-family: 'codicon';
            src: url('https://unpkg.com/@vscode/codicons@0.0.32/dist/codicon.ttf') format('truetype');
        }
        .codicon {
            font-family: 'codicon';
            font-size: 16px;
            font-style: normal;
            font-weight: normal;
            line-height: 1;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }
        .codicon-edit:before { content: "\\eb56"; }
        .codicon-trash:before { content: "\\ea81"; }
        
        body {
            padding: 20px;
        }
        .container {
            max-width: none !important;
        }
        .page-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 20px;
        }
        .header-info h1 {
            margin: 0 0 8px 0;
        }
        .toolbar {
            display: flex;
            gap: 8px;
        }
        .permissions-grid {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .permissions-header {
            display: grid;
            grid-template-columns: 250px 1fr 200px 120px;
            gap: 16px;
            padding: 14px 16px;
            background-color: var(--vscode-editor-background);
            border-bottom: 2px solid var(--vscode-panel-border);
            font-weight: 600;
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-foreground);
        }
        .permissions-row {
            display: grid;
            grid-template-columns: 250px 1fr 200px 120px;
            gap: 16px;
            padding: 14px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            align-items: center;
            transition: background-color 0.15s ease;
        }
        .permissions-row:last-child {
            border-bottom: none;
        }
        .permissions-row:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .grantee-cell {
            font-weight: 500;
            color: var(--vscode-foreground);
        }
        .privilege-badge {
            display: inline-block;
            padding: 5px 10px;
            margin: 3px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            letter-spacing: 0.3px;
        }
        .grantable {
            border-color: var(--vscode-charts-green);
        }
        .more-badge {
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border: 1px solid var(--vscode-badge-background);
            cursor: help;
        }
        .actions-cell {
            display: flex;
            gap: 4px;
        }
        .action-btn {
            background: transparent;
            border: none;
            color: var(--vscode-button-foreground);
            cursor: pointer;
            padding: 4px 6px;
            border-radius: 3px;
            font-size: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.15s ease;
        }
        .action-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .grantor-cell {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .no-permissions {
            padding: 40px 16px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .privileges-cell {
            display: flex;
            align-items: center;
            gap: 3px;
            overflow: hidden;
            min-width: 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="page-header">
            <div class="header-info">
                <h1>Manage Permissions: ${schema}.${objectName}</h1>
                <div class="info-text">Object Type: ${objectType}</div>
            </div>
            <div class="toolbar">
                <button class="btn" id="grantBtn">Grant Privileges</button>
                <button class="btn btn-secondary" id="refreshBtn">Refresh</button>
            </div>
        </div>

        <div class="permissions-grid" id="permissionsGrid">
            <div class="permissions-header">
                <div>Grantee</div>
                <div>Privileges</div>
                <div>Grantor</div>
                <div>Actions</div>
            </div>
            <div id="permissionsList">
                <!-- Will be populated by JavaScript -->
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let permissions = ${permissionsJson};
        
        const grantBtn = document.getElementById('grantBtn');
        const refreshBtn = document.getElementById('refreshBtn');
        const permissionsList = document.getElementById('permissionsList');

        // Render permissions list
        function renderPermissions() {
            if (permissions.length === 0) {
                permissionsList.innerHTML = '<div class="no-permissions">No permissions granted</div>';
                return;
            }

            // Group permissions by grantee
            const grouped = {};
            permissions.forEach(perm => {
                if (!grouped[perm.grantee]) {
                    grouped[perm.grantee] = {
                        grantee: perm.grantee,
                        grantor: perm.grantor || 'N/A',
                        privileges: []
                    };
                }
                grouped[perm.grantee].privileges.push({
                    type: perm.privilege_type,
                    grantable: perm.is_grantable === 'YES'
                });
            });

            permissionsList.innerHTML = Object.values(grouped).map((group, index) => {
                const rowId = 'priv-row-' + index;
                const maxVisible = 4;
                const visiblePrivileges = group.privileges.slice(0, maxVisible);
                const hiddenPrivileges = group.privileges.slice(maxVisible);
                const hiddenCount = hiddenPrivileges.length;
                
                const privilegesBadges = visiblePrivileges.map(p => 
                    \`<span class="privilege-badge \${p.grantable ? 'grantable' : ''}" title="\${p.grantable ? 'Grantable' : 'Not grantable'}">\${p.type}</span>\`
                ).join('');
                
                const hiddenTooltip = hiddenPrivileges.map(p => p.type + (p.grantable ? ' (grantable)' : '')).join('\\n');
                const moreBadge = hiddenCount > 0 ? 
                    \`<span class="privilege-badge more-badge" title="\${hiddenTooltip}">+\${hiddenCount}</span>\` 
                    : '';
                
                return \`
                    <div class="permissions-row" data-row-id="\${rowId}">
                        <div class="grantee-cell">\${group.grantee}</div>
                        <div class="privileges-cell" id="\${rowId}">
                            \${privilegesBadges}
                            \${moreBadge}
                        </div>
                        <div class="grantor-cell">\${group.grantor}</div>
                        <div class="actions-cell">
                            <button class="action-btn" onclick="editPermissions('\${group.grantee}')" title="Edit privileges">
                                <span class="codicon codicon-edit"></span>
                            </button>
                            <button class="action-btn" onclick='revokePermissions("\${group.grantee}", \${JSON.stringify(group.privileges.map(p => p.type))})' title="Revoke all privileges">
                                <span class="codicon codicon-trash"></span>
                            </button>
                        </div>
                    </div>
                \`;
            }).join('');
            
            // After rendering, check each row for overflow and adjust
            setTimeout(() => adjustPrivilegeOverflow(), 0);
        }
        
        function adjustPrivilegeOverflow() {
            const rows = document.querySelectorAll('.permissions-row');
            rows.forEach(row => {
                const privilegesCell = row.querySelector('.privileges-cell');
                if (!privilegesCell) return;
                
                const badges = Array.from(privilegesCell.querySelectorAll('.privilege-badge:not(.more-badge)'));
                const moreBadge = privilegesCell.querySelector('.more-badge');
                
                if (badges.length === 0) return;
                
                // Check if content is overflowing
                const isOverflowing = privilegesCell.scrollWidth > privilegesCell.clientWidth;
                
                if (isOverflowing) {
                    // Hide badges one by one until no overflow
                    let hiddenCount = moreBadge ? parseInt(moreBadge.textContent.match(/\\d+/)[0]) : 0;
                    let hiddenPrivileges = [];
                    
                    for (let i = badges.length - 1; i >= 0; i--) {
                        if (privilegesCell.scrollWidth <= privilegesCell.clientWidth) break;
                        
                        const badge = badges[i];
                        const privName = badge.textContent.trim();
                        const isGrantable = badge.classList.contains('grantable');
                        
                        hiddenPrivileges.unshift({ name: privName, grantable: isGrantable });
                        badge.style.display = 'none';
                        hiddenCount++;
                    }
                    
                    // Update or create more badge
                    if (hiddenCount > 0) {
                        const tooltipText = hiddenPrivileges.map(p => p.name + (p.grantable ? ' (grantable)' : '')).join('\\n');
                        
                        if (moreBadge) {
                            const existingTooltip = moreBadge.getAttribute('title');
                            moreBadge.textContent = '+' + hiddenCount;
                            moreBadge.setAttribute('title', tooltipText + (existingTooltip ? '\\n' + existingTooltip : ''));
                        } else {
                            const newMoreBadge = document.createElement('span');
                            newMoreBadge.className = 'privilege-badge more-badge';
                            newMoreBadge.textContent = '+' + hiddenCount;
                            newMoreBadge.setAttribute('title', tooltipText);
                            privilegesCell.appendChild(newMoreBadge);
                        }
                    }
                }
            });
        }
        
        // Re-adjust on window resize
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(adjustPrivilegeOverflow, 100);
        });

        window.revokePermissions = function(grantee, privileges) {
            // Send message to extension host to show confirmation dialog
            vscode.postMessage({
                command: 'confirmRevoke',
                grantee: grantee,
                privileges: privileges
            });
        };

        window.editPermissions = function(grantee) {
            // Find the current permissions for this grantee
            const currentPerms = permissions.filter(p => p.grantee === grantee);
            vscode.postMessage({
                command: 'openEditPermission',
                grantee: grantee,
                currentPermissions: currentPerms
            });
        };

        grantBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'openGrantPermission' });
        });

        refreshBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'refresh' });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'updatePermissions':
                    permissions = message.permissions;
                    renderPermissions();
                    break;
            }
        });

        // Initialize
        renderPermissions();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for grant permission panel
     */
    private static getGrantPermissionHtml(
        objectType: string,
        objectName: string,
        schema: string,
        roles: any[],
        availablePrivileges: string[]
    ): string {
        const rolesJson = JSON.stringify(roles);
        const privilegesJson = JSON.stringify(availablePrivileges);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Grant Permissions</title>
    ${getStyles()}
    <style>
        .privilege-selector {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 8px;
            margin: 8px 0;
        }
        .privilege-option {
            display: flex;
            align-items: center;
            gap: 6px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Grant Permissions: ${schema}.${objectName}</h1>
        <div class="info-text" style="margin-bottom: 16px;">Object Type: ${objectType}</div>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <h2>Grant New Permissions</h2>
            
            <div class="form-group">
                <label>Grantee (Role/User) <span class="required">*</span></label>
                <select id="granteeSelect">
                    <option value="">-- Select Role --</option>
                    <option value="PUBLIC">PUBLIC (All Users)</option>
                    ${roles.map(r => `<option value="${r.rolname}">${r.rolname}</option>`).join('')}
                </select>
            </div>

            <div class="form-group">
                <label>Privileges <span class="required">*</span></label>
                <div class="privilege-selector" id="privilegeSelector">
                    <!-- Will be populated by JavaScript -->
                </div>
            </div>

            <div class="checkbox-group">
                <input type="checkbox" id="withGrantOption" />
                <label for="withGrantOption">WITH GRANT OPTION (Allow grantee to grant these privileges to others)</label>
            </div>

            <div class="actions">
                <button class="btn" id="grantBtn">Grant Permissions</button>
                <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const roles = ${rolesJson};
        const availablePrivileges = ${privilegesJson};
        
        const granteeSelect = document.getElementById('granteeSelect');
        const privilegeSelector = document.getElementById('privilegeSelector');
        const withGrantOption = document.getElementById('withGrantOption');
        const grantBtn = document.getElementById('grantBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        // Render privilege checkboxes
        function renderPrivilegeSelector() {
            privilegeSelector.innerHTML = availablePrivileges.map(priv => \`
                <div class="privilege-option">
                    <input type="checkbox" id="priv_\${priv}" value="\${priv}" />
                    <label for="priv_\${priv}">\${priv}</label>
                </div>
            \`).join('');
        }

        grantBtn.addEventListener('click', () => {
            clearError();
            
            const grantee = granteeSelect.value;
            if (!grantee) {
                showError('Please select a grantee');
                return;
            }

            const selectedPrivileges = Array.from(privilegeSelector.querySelectorAll('input:checked')).map(cb => cb.value);
            if (selectedPrivileges.length === 0) {
                showError('Please select at least one privilege');
                return;
            }

            grantBtn.disabled = true;
            grantBtn.textContent = 'Granting...';

            vscode.postMessage({
                command: 'grantPermission',
                grantee: grantee,
                privileges: selectedPrivileges,
                withGrantOption: withGrantOption.checked
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
                    grantBtn.disabled = false;
                    grantBtn.textContent = 'Grant Permissions';
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

        // Initialize
        renderPrivilegeSelector();
    </script>
</body>
</html>`;
    }

    /**
     * Get HTML for edit permission panel
     */
    private static getEditPermissionHtml(
        objectType: string,
        objectName: string,
        schema: string,
        grantee: string,
        currentPermissions: any[],
        availablePrivileges: string[]
    ): string {
        const privilegesJson = JSON.stringify(availablePrivileges);
        const currentPermsJson = JSON.stringify(currentPermissions);
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit Permissions</title>
    ${getStyles()}
    <style>
        .privilege-selector {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 12px;
            margin: 8px 0;
        }
        .privilege-option {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            background-color: var(--vscode-input-background);
        }
        .privilege-option label {
            font-weight: 500;
        }
        .grant-option-checkbox {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-left: 20px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Edit Permissions: ${grantee}</h1>
        <div class="info-text" style="margin-bottom: 16px;">Object: ${schema}.${objectName} (${objectType})</div>
        
        <div id="errorContainer"></div>

        <div class="section-box">
            <h2>Select Privileges</h2>
            <div class="info-text" style="margin-bottom: 12px;">Check the privileges to grant and whether they should be grantable to others.</div>
            
            <div class="privilege-selector" id="privilegeSelector">
                <!-- Will be populated by JavaScript -->
            </div>

            <div class="actions">
                <button class="btn" id="updateBtn">Update Permissions</button>
                <button class="btn btn-secondary" id="cancelBtn">Cancel</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const availablePrivileges = ${privilegesJson};
        const currentPermissions = ${currentPermsJson};
        
        const privilegeSelector = document.getElementById('privilegeSelector');
        const updateBtn = document.getElementById('updateBtn');
        const cancelBtn = document.getElementById('cancelBtn');
        const errorContainer = document.getElementById('errorContainer');

        // Create a map of current privileges
        const currentPrivMap = {};
        currentPermissions.forEach(p => {
            currentPrivMap[p.privilege_type] = {
                granted: true,
                grantable: p.is_grantable === 'YES'
            };
        });

        // Render privilege selector with checkboxes
        function renderPrivilegeSelector() {
            privilegeSelector.innerHTML = availablePrivileges.map(priv => {
                const current = currentPrivMap[priv] || { granted: false, grantable: false };
                return \`
                    <div class="privilege-option">
                        <div>
                            <input type="checkbox" id="priv_\${priv}" value="\${priv}" \${current.granted ? 'checked' : ''} />
                            <label for="priv_\${priv}">\${priv}</label>
                        </div>
                        <div class="grant-option-checkbox">
                            <input type="checkbox" id="grant_\${priv}" \${current.grantable ? 'checked' : ''} \${!current.granted ? 'disabled' : ''} />
                            <label for="grant_\${priv}">With grant option</label>
                        </div>
                    </div>
                \`;
            }).join('');

            // Add event listeners to enable/disable grant option checkboxes
            availablePrivileges.forEach(priv => {
                const privCheckbox = document.getElementById('priv_' + priv);
                const grantCheckbox = document.getElementById('grant_' + priv);
                
                privCheckbox.addEventListener('change', () => {
                    grantCheckbox.disabled = !privCheckbox.checked;
                    if (!privCheckbox.checked) {
                        grantCheckbox.checked = false;
                    }
                });
            });
        }

        updateBtn.addEventListener('click', () => {
            clearError();
            
            // Collect selected privileges
            const privileges = [];
            availablePrivileges.forEach(priv => {
                const privCheckbox = document.getElementById('priv_' + priv);
                const grantCheckbox = document.getElementById('grant_' + priv);
                
                if (privCheckbox.checked) {
                    privileges.push({
                        privilege: priv,
                        withGrantOption: grantCheckbox.checked
                    });
                }
            });

            updateBtn.disabled = true;
            updateBtn.textContent = 'Updating...';

            vscode.postMessage({
                command: 'updatePermission',
                privileges: privileges,
                withGrantOption: false // Not used anymore, per-privilege grant options
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
                    updateBtn.textContent = 'Update Permissions';
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

        // Initialize
        renderPrivilegeSelector();
    </script>
</body>
</html>`;
    }

    /**
     * Get available privileges for object type
     */
    private static getAvailablePrivileges(objectType: string): string[] {
        switch (objectType) {
            case 'TABLE':
            case 'VIEW':
                return ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
            case 'FUNCTION':
                return ['EXECUTE'];
            case 'SEQUENCE':
                return ['USAGE', 'SELECT', 'UPDATE'];
            case 'SCHEMA':
                return ['CREATE', 'USAGE'];
            default:
                return [];
        }
    }
}

