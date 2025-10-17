import * as vscode from 'vscode';
import { SchemaService, SchemaItem } from './services/schema.service';
import { StateService } from './services/state.service';
import { AuthManager } from './auth/authManager';
import { SqlQueryPanel } from './sqlQueryPanel';
import { TableDataPanel } from './tableDataPanel';
import { DockerService } from './services/docker.service';
import { CreateTablePanel } from './createTablePanel';
import { EditTablePanel } from './editTablePanel';
import { SchemaManagementPanel } from './schemaManagementPanel';
import { IndexManagementPanel } from './indexManagementPanel';
import { ConstraintManagementPanel } from './constraintManagementPanel';
import { PolicyManagementPanel } from './policyManagementPanel';
import { ViewManagementPanel } from './viewManagementPanel';
import { UserManagementPanel } from './userManagementPanel';
import { DataImportExportPanel } from './dataImportExportPanel';
import { FunctionManagementPanel } from './functionManagementPanel';
import { DatabaseManagementPanel } from './databaseManagementPanel';
import { SequenceManagementPanel } from './sequenceManagementPanel';
import { ForeignKeyManagementPanel } from './foreignKeyManagementPanel';
import { TriggerManagementPanel } from './triggerManagementPanel';
import { ModelGeneratorPanel } from './modelGeneratorPanel';
import { ColumnManagementPanel } from './columnManagementPanel';

export class SchemaTreeItem extends vscode.TreeItem {
    constructor(
        public readonly item: SchemaItem,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(item.name, collapsibleState);
        
        this.tooltip = this.getTooltip();
        this.description = this.getDescription();
        this.iconPath = this.getIcon();
        
        // Set contextValue - use specific values for containers
        if (item.type === 'container') {
            const containerType = item.metadata?.containerType;
            if (containerType === 'roles') {
                this.contextValue = 'rolesContainer';
            } else if (containerType === 'databases') {
                this.contextValue = 'databasesContainer';
            } else if (containerType === 'schemas') {
                this.contextValue = 'schemasContainer';
            } else if (containerType === 'tables') {
                this.contextValue = 'tablesContainer';
            } else if (containerType === 'views') {
                this.contextValue = 'viewsContainer';
            } else if (containerType === 'functions') {
                this.contextValue = 'functionsContainer';
            } else if (containerType === 'sequences') {
                this.contextValue = 'sequencesContainer';
            } else if (containerType === 'columns') {
                // Distinguish between table columns and view columns
                const parentType = item.metadata?.parentType;
                this.contextValue = parentType === 'view' ? 'viewColumnsContainer' : 'columnsContainer';
            } else if (containerType === 'indexes') {
                this.contextValue = 'indexesContainer';
            } else if (containerType === 'constraints') {
                this.contextValue = 'constraintsContainer';
            } else if (containerType === 'triggers') {
                this.contextValue = 'triggersContainer';
            } else if (containerType === 'policies') {
                this.contextValue = 'policiesContainer';
            } else {
                this.contextValue = 'container';
            }
        } else if (item.type === 'column' && item.metadata?.parentType === 'view') {
            // View columns should not be editable
            this.contextValue = 'viewColumn';
        } else if (item.type === 'trigger') {
            // Set context value based on trigger enabled status
            this.contextValue = item.metadata?.is_enabled ? 'triggerEnabled' : 'triggerDisabled';
        } else {
            this.contextValue = item.type;
        }
        
        // Set command for leaf items
        if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
            this.command = {
                command: 'neonLocal.schema.showDetails',
                title: 'Show Details',
                arguments: [item]
            };
        }
    }

    private getTooltip(): string {
        const { item } = this;
        switch (item.type) {
            case 'connection':
                const connection = item.metadata;
                const branchDisplayName = connection?.branchName || 'Unknown';
                
                return `Database Branch: ${branchDisplayName}\nProject: ${connection?.projectName || 'Unknown Project'}${connection?.port ? `\nPort: ${connection.port}` : ''}`;
            case 'database':
                return `Database: ${item.name}${item.metadata?.size ? ` (${item.metadata.size})` : ''}`;
            case 'schema':
                return `Schema: ${item.name}`;
            case 'table':
                return `Table: ${item.name}${item.metadata?.size ? ` (${item.metadata.size})` : ''}`;
            case 'view':
                return `View: ${item.name}`;
            case 'column':
                const column = item.metadata;
                let tooltip = `Column: ${item.name} (${column?.data_type || 'unknown'})`;
                if (column?.is_primary_key) tooltip += ' - PRIMARY KEY';
                if (column?.is_foreign_key) tooltip += ' - FOREIGN KEY';
                if (!column?.is_nullable) tooltip += ' - NOT NULL';
                return tooltip;
            case 'index':
                const index = item.metadata;
                let indexTooltip = `Index: ${item.name}`;
                if (index?.is_primary) indexTooltip += ' - PRIMARY';
                else if (index?.is_unique) indexTooltip += ' - UNIQUE';
                return indexTooltip;
            case 'function':
                const func = item.metadata;
                return `Function: ${item.name}(${func?.parameters || ''}) → ${func?.return_type || 'void'}`;
            case 'trigger':
                const trigger = item.metadata;
                const events = Array.isArray(trigger?.events) ? trigger.events.filter(Boolean).join(', ') : (trigger?.event || 'Unknown');
                const status = trigger?.is_enabled ? '✓ Enabled' : '✗ Disabled';
                return `Trigger: ${item.name}\n${trigger?.timing || 'Unknown'} ${events}\nLevel: FOR EACH ${trigger?.level || 'Unknown'}\nFunction: ${trigger?.function_schema}.${trigger?.function_name}()\nStatus: ${status}`;
            case 'policy':
                const policy = item.metadata;
                let policyTooltip = `RLS Policy: ${item.name}\nType: ${policy?.type_label || 'Unknown'}\nCommand: ${policy?.command_label || 'Unknown'}`;
                if (policy?.roles) {
                    // Ensure roles is an array (it might be a string or other type in some cases)
                    const rolesArray = Array.isArray(policy.roles) ? policy.roles : 
                                      (policy.roles === null || policy.roles === undefined) ? [] :
                                      [policy.roles];
                    if (rolesArray.length > 0) {
                        policyTooltip += `\nRoles: ${rolesArray.join(', ')}`;
                    } else {
                        policyTooltip += `\nRoles: PUBLIC (all)`;
                    }
                }
                if (policy?.using_expression) {
                    policyTooltip += `\nUSING: ${policy.using_expression}`;
                }
                return policyTooltip;
            case 'sequence':
                const seq = item.metadata;
                return `Sequence: ${item.name}\nStart: ${seq?.start_value || 'N/A'}, Increment: ${seq?.increment || 'N/A'}`;
            case 'foreignkey':
                const fk = item.metadata;
                return `Foreign Key: ${item.name}\nColumns: ${fk?.columns || 'N/A'}\nReferences: ${fk?.foreign_table_schema}.${fk?.foreign_table_name}(${fk?.foreign_columns})`;
            case 'constraint':
                const constraint = item.metadata;
                let constraintTooltip = `${constraint?.constraint_type_label || 'Constraint'}: ${item.name}`;
                if (constraint?.definition) {
                    constraintTooltip += `\nDefinition: ${constraint.definition}`;
                }
                if (constraint?.is_deferrable) {
                    constraintTooltip += '\nDeferrable: Yes';
                    constraintTooltip += constraint.is_deferred ? ' (Initially Deferred)' : ' (Initially Immediate)';
                }
                return constraintTooltip;
            case 'role':
                const role = item.metadata;
                let roleTooltip = `Role: ${item.name}`;
                const attributes = [];
                if (role?.is_superuser) attributes.push('Superuser');
                if (role?.can_create_db) attributes.push('Create DB');
                if (role?.can_create_role) attributes.push('Create Role');
                if (role?.can_login) attributes.push('Login');
                if (attributes.length > 0) roleTooltip += `\nAttributes: ${attributes.join(', ')}`;
                return roleTooltip;
            default:
                return item.name;
        }
    }

    private getDescription(): string | undefined {
        const { item } = this;
        switch (item.type) {
            case 'connection':
                const connection = item.metadata;
                return 'BRANCH';
            case 'column':
                const column = item.metadata;
                if (column?.data_type) {
                    let desc = column.data_type.toUpperCase();
                    if (column.character_maximum_length) {
                        desc += `(${column.character_maximum_length})`;
                    }
                    return desc;
                }
                break;
            case 'table':
            case 'view':
                return item.metadata?.table_type?.toUpperCase();
            case 'index':
                if (item.metadata?.is_primary) return 'PRIMARY';
                if (item.metadata?.is_unique) return 'UNIQUE';
                break;
            case 'constraint':
                return item.metadata?.constraint_type_label?.toUpperCase();
            case 'policy':
                return item.metadata?.command_label?.toUpperCase();
            case 'trigger':
                return item.metadata?.is_enabled ? 'ENABLED' : 'DISABLED';
        }
        return undefined;
    }

    private getIcon(): vscode.ThemeIcon | undefined {
        // Hierarchy-based coloring:
        // Level 1 (Connection): Green
        // Level 2 (Database): Cyan
        // Level 3 (Schema): Blue
        // Level 4 (Table, View, Function, Sequence, Role): Purple
        // Level 5 (Column, Index, Constraint, Trigger, Policy, Foreign Key): Magenta
        
        switch (this.item.type) {
            case 'connection':
                // Level 1 - Green
                return new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('charts.green'));
            case 'database':
                // Level 2 - Cyan
                return new vscode.ThemeIcon('database', new vscode.ThemeColor('terminal.ansiCyan'));
            case 'schema':
                // Level 3 - Blue
                return new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
            case 'table':
                // Level 4 - Purple
                return new vscode.ThemeIcon('table', new vscode.ThemeColor('charts.purple'));
            case 'view':
                // Level 4 - Purple
                return new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.purple'));
            case 'function':
                // Level 4 - Purple
                return new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('charts.purple'));
            case 'sequence':
                // Level 4 - Purple
                return new vscode.ThemeIcon('symbol-numeric', new vscode.ThemeColor('charts.purple'));
            case 'role':
                // Same as database - Cyan
                return new vscode.ThemeIcon('account', new vscode.ThemeColor('terminal.ansiCyan'));
            case 'column':
                // Level 5 - Magenta
                const column = this.item.metadata;
                const columnColor = new vscode.ThemeColor('terminal.ansiMagenta');
                if (column?.is_primary_key) {
                    return new vscode.ThemeIcon('key', columnColor);
                } else if (column?.is_foreign_key) {
                    return new vscode.ThemeIcon('link', columnColor);
                } else {
                    return new vscode.ThemeIcon('symbol-field', columnColor);
                }
            case 'index':
                // Level 5 - Magenta
                return new vscode.ThemeIcon('list-ordered', new vscode.ThemeColor('terminal.ansiMagenta'));
            case 'constraint':
                // Level 5 - Magenta
                return new vscode.ThemeIcon('shield', new vscode.ThemeColor('terminal.ansiMagenta'));
            case 'foreignkey':
                // Level 5 - Magenta
                return new vscode.ThemeIcon('link', new vscode.ThemeColor('terminal.ansiMagenta'));
            case 'trigger':
                // Level 5 - Magenta
                return new vscode.ThemeIcon('play', new vscode.ThemeColor('terminal.ansiMagenta'));
            case 'policy':
                // Level 5 - Magenta
                return new vscode.ThemeIcon('shield-check', new vscode.ThemeColor('terminal.ansiMagenta'));
            case 'container':
                // Container nodes - no icons for grouping nodes
                return undefined;
            default:
                return new vscode.ThemeIcon('symbol-misc');
        }
    }

    private getContainerIcon(containerType: string): vscode.ThemeIcon {
        switch (containerType) {
            case 'databases':
                // Blue for databases container
                return new vscode.ThemeIcon('database', new vscode.ThemeColor('charts.blue'));
            case 'schemas':
                // Yellow for schemas container
                return new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('charts.yellow'));
            case 'roles':
                // Bright cyan for roles container
                return new vscode.ThemeIcon('organization', new vscode.ThemeColor('terminal.ansiBrightCyan'));
            case 'tables':
                // Green for tables container
                return new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('charts.green'));
            case 'views':
                // Purple for views container
                return new vscode.ThemeIcon('symbol-interface', new vscode.ThemeColor('charts.purple'));
            case 'functions':
                // Orange for functions container
                return new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('charts.orange'));
            case 'sequences':
                // Bright magenta for sequences container
                return new vscode.ThemeIcon('symbol-numeric', new vscode.ThemeColor('terminal.ansiBrightMagenta'));
            case 'columns':
                // Bright yellow for columns container
                return new vscode.ThemeIcon('list-unordered', new vscode.ThemeColor('terminal.ansiBrightYellow'));
            case 'indexes':
                // Bright blue for indexes container
                return new vscode.ThemeIcon('list-ordered', new vscode.ThemeColor('terminal.ansiBrightBlue'));
            case 'constraints':
                // Red for constraints container
                return new vscode.ThemeIcon('shield', new vscode.ThemeColor('terminal.ansiRed'));
            case 'triggers':
                // Bright green for triggers container
                return new vscode.ThemeIcon('flash', new vscode.ThemeColor('terminal.ansiGreen'));
            case 'policies':
                // Bright green for policies container
                return new vscode.ThemeIcon('lock', new vscode.ThemeColor('terminal.ansiBrightGreen'));
            default:
                return new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.blue'));
        }
    }
}

export class SchemaTreeProvider implements vscode.TreeDataProvider<SchemaItem> {
    public _onDidChangeTreeData: vscode.EventEmitter<SchemaItem | undefined | null | void> = new vscode.EventEmitter<SchemaItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SchemaItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private schemaCache = new Map<string, SchemaItem[]>();
    public containerReadyCache: { isReady: boolean; timestamp: number } | null = null;
    private readonly CONTAINER_CHECK_CACHE_DURATION = 10000; // 10 seconds
    private isPreloading = false;

    constructor(
        private schemaService: SchemaService,
        private stateService: StateService,
        private authManager: AuthManager,
        private dockerService: DockerService
    ) {
        // Listen for authentication state changes
        this.authManager.onDidChangeAuthentication((isAuthenticated) => {
            console.debug('Schema tree: Authentication state changed', { isAuthenticated });
            if (!isAuthenticated) {
                this.clearCache();
                // Don't auto-refresh - require manual refresh
            }
        });
    }

    refresh(): void {
        this.clearCache();
        this._onDidChangeTreeData.fire();
    }

    public clearCache(): void {
        this.schemaCache.clear();
        this.containerReadyCache = null;
        this.isPreloading = false;
        console.debug('Schema view: All caches cleared');
    }

    public forceRefresh(): void {
        console.debug('Schema view: Force refresh triggered - clearing all caches and refreshing');
        this.clearCache();
        this._onDidChangeTreeData.fire();
        // Also fire a delayed refresh to ensure VS Code processes the change
        setTimeout(() => {
            this._onDidChangeTreeData.fire();
        }, 50);
    }

    private async checkContainerReadyWithCache(): Promise<boolean> {
        const now = Date.now();
        
        // Return cached result if still valid
        if (this.containerReadyCache && 
            (now - this.containerReadyCache.timestamp) < this.CONTAINER_CHECK_CACHE_DURATION) {
            return this.containerReadyCache.isReady;
        }
        
        // Check container readiness
        try {
            const isReady = await this.dockerService.checkContainerReady();
            this.containerReadyCache = { isReady, timestamp: now };
            return isReady;
        } catch (error) {
            console.error('Error checking container readiness:', error);
            // Cache negative result for shorter duration
            this.containerReadyCache = { isReady: false, timestamp: now - (this.CONTAINER_CHECK_CACHE_DURATION - 2000) };
            return false;
        }
    }

    getTreeItem(element: SchemaItem): vscode.TreeItem {
        const hasChildren = this.hasChildren(element);
        const collapsibleState = hasChildren ? 
            vscode.TreeItemCollapsibleState.Collapsed : 
            vscode.TreeItemCollapsibleState.None;
        
        return new SchemaTreeItem(element, collapsibleState);
    }

    private hasChildren(element: SchemaItem): boolean {
        switch (element.type) {
            case 'connection':
            case 'database':
            case 'schema':
                return true;
            case 'table':
                return true; // Tables have columns, indexes, and potentially triggers
            case 'view':
                return true; // Views have columns
            case 'container':
                return true; // Container nodes (Tables, Views, Indexes, etc.)
            default:
                return false;
        }
    }

    async getChildren(element?: SchemaItem): Promise<SchemaItem[]> {
        try {
            // Check if connected
            const viewData = await this.stateService.getViewData();
            if (!viewData.connected) {
                return [];
            }

            // Check if proxy container is ready before loading data (with caching)
            const isContainerReady = await this.checkContainerReadyWithCache();
            if (!isContainerReady) {
                console.warn('Schema view: Proxy container is not ready yet');
                vscode.window.showWarningMessage('Database proxy is not ready yet. Please wait for the container to start completely.');
                return [];
            }

            if (!element) {
                // Root level - show connection root node and preload all data
                const connectionRoot = this.getConnectionRoot(viewData);
                console.debug('Schema view: Returning root connection node for branch:', viewData.currentlyConnectedBranch);
                
                // Start preloading all schema data in the background (only if not already preloading)
                if (!this.isPreloading) {
                    this.isPreloading = true;
                    this.preloadAllSchemaData().catch(error => {
                        console.error('Error preloading schema data:', error);
                    }).finally(() => {
                        this.isPreloading = false;
                    });
                }
                return connectionRoot;
            }

            const cacheKey = element.id;
            if (this.schemaCache.has(cacheKey)) {
                console.debug(`Schema view: Returning cached data for ${cacheKey}`);
                return this.schemaCache.get(cacheKey)!;
            }

            let children: SchemaItem[] = [];

            switch (element.type) {
                case 'connection':
                    children = await Promise.race([
                        this.getConnectionChildren(),
                        new Promise<SchemaItem[]>((_, reject) => 
                            setTimeout(() => reject(new Error('Connection timeout')), 5000)
                        )
                    ]);
                    break;
                case 'database':
                    // Return schemas container for the database
                    children = [{
                        id: `container_schemas_${element.name}`,
                        name: 'Schemas',
                        type: 'container' as any,
                        metadata: { containerType: 'schemas', database: element.name }
                    }];
                    break;
                case 'schema':
                    console.log('[SCHEMA VIEW] Getting schema containers for:', element.name);
                    children = await this.getSchemaContainers(element);
                    console.log('[SCHEMA VIEW] Schema containers:', children.map(c => c.name));
                    break;
                case 'container':
                    children = await this.getContainerChildren(element);
                    break;
                case 'table':
                case 'view':
                    // Parse using parent to handle underscores in schema names correctly
                    // Parent format: schema_v2_database_schema (where schema can have underscores)
                    let tableDatabase: string;
                    let tableSchema: string;
                    let tableName: string;
                    
                    if (element.parent) {
                        const parentParts = element.parent.split('_');
                        // parent format: schema_v2_database_schema...
                        tableDatabase = parentParts[2];
                        tableSchema = parentParts.slice(3).join('_');
                        // Extract table name from ID: remove "table_" or "view_" prefix and the database_schema prefix
                        const prefix = `${element.type}_${tableDatabase}_${tableSchema}_`;
                        tableName = element.id.substring(prefix.length);
                    } else {
                        // Fallback to old parsing (shouldn't happen with new data structure)
                        const tableParts = element.id.split('_');
                        tableDatabase = tableParts[1];
                        tableSchema = tableParts[2];
                        tableName = tableParts.slice(3).join('_');
                    }
                    
                    children = await this.getTableContainers(tableDatabase, tableSchema, tableName, element.type);
                    break;
            }

            this.schemaCache.set(cacheKey, children);
            return children;

        } catch (error) {
            console.error('Error getting schema children:', error);
            vscode.window.showErrorMessage(`Failed to load schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return [];
        }
    }

    private getConnectionRoot(viewData: any): SchemaItem[] {
        const connectionType = viewData.connectionType || 'existing';
        const branchId = viewData.currentlyConnectedBranch || 'Unknown Branch';
        const branchName = viewData.selectedBranchName || viewData.connection?.selectedBranchName;
        
        // For existing branches, use the branch name if available, otherwise fall back to ID
        // For ephemeral branches (type 'new'), always use the branch ID
        let displayName: string;
        if (connectionType === 'existing' && branchName) {
            displayName = branchName;
        } else {
            displayName = branchId;
        }
        
        const projectName = viewData.connection?.selectedProjectName || 'Unknown Project';
        const orgName = viewData.connection?.selectedOrgName || 'Unknown Organization';
        const selectedDatabase = viewData.selectedDatabase || 'postgres';
        const port = viewData.port || 5432;

        console.debug('Schema view: Creating connection root', {
            connectionType,
            branchId,
            branchName,
            displayName,
            projectName
        });

        const connectionItem: SchemaItem = {
            id: 'connection_root',
            name: `${displayName}`,
            type: 'connection' as const,
            parent: undefined,
            metadata: {
                branchName: displayName,
                branchId,
                actualBranchName: branchName,
                connectionType,
                projectName,
                orgName,
                selectedDatabase,
                port
            }
        };

        return [connectionItem];
    }

    private async getDatabases(): Promise<SchemaItem[]> {
        try {
            console.debug('Schema view: Fetching databases from service');
            const databases = await this.schemaService.getDatabases();
            console.debug(`Schema view: Retrieved ${databases.length} databases`);
            return databases;
        } catch (error) {
            console.error('Error fetching databases:', error);
            return [];
        }
    }

    private async getSchemas(database: string): Promise<SchemaItem[]> {
        try {
            return await this.schemaService.getSchemas(database);
        } catch (error) {
            console.error('Error fetching schemas:', error);
            return [];
        }
    }

    private async getConnectionChildren(): Promise<SchemaItem[]> {
        try {
            // Get databases
            const databases = await this.getDatabases();
            
            // Create "Databases" container
            const databasesContainer: SchemaItem = {
                id: `container_databases_cluster`,
                name: 'Databases',
                type: 'container' as any,
                metadata: { containerType: 'databases' }
            };
            
            // Create "Roles" container at connection level (roles are cluster-wide, not database-specific)
            const rolesContainer: SchemaItem = {
                id: `container_roles_cluster`,
                name: 'Roles',
                type: 'container' as any,
                metadata: { containerType: 'roles' }
            };
            
            // Return databases container first, then roles container
            return [databasesContainer, rolesContainer];
        } catch (error) {
            console.error('Error fetching connection children:', error);
            return [];
        }
    }

    private async getSchemaContainers(schemaItem: SchemaItem): Promise<SchemaItem[]> {
        // Create container nodes for organizing schema objects
        // Parse ID format: schema_v2_database_schema OR schema_database_schema
        const parts = schemaItem.id.split('_');
        const database = parts[1] === 'v2' ? parts[2] : parts[1];
        const schema = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');
        const baseId = `${database}_${schema}`;

        return [
            {
                id: `container_tables_${baseId}`,
                name: 'Tables',
                type: 'container' as any,
                metadata: { containerType: 'tables', database, schema }
            },
            {
                id: `container_views_${baseId}`,
                name: 'Views',
                type: 'container' as any,
                metadata: { containerType: 'views', database, schema }
            },
            {
                id: `container_functions_${baseId}`,
                name: 'Functions',
                type: 'container' as any,
                metadata: { containerType: 'functions', database, schema }
            },
            {
                id: `container_sequences_${baseId}`,
                name: 'Sequences',
                type: 'container' as any,
                metadata: { containerType: 'sequences', database, schema }
            }
        ];
    }

    private async getContainerChildren(containerItem: SchemaItem): Promise<SchemaItem[]> {
        try {
            const { containerType, database, schema } = containerItem.metadata;
            console.log(`[SCHEMA VIEW] Getting children for container: ${containerType} in ${database}.${schema}`);
            
            let result: SchemaItem[] = [];
            switch (containerType) {
                case 'databases':
                    result = await this.getDatabases();
                    break;
                case 'schemas':
                    result = await this.getSchemas(database);
                    break;
                case 'roles':
                    result = await this.getRoles();
                    break;
                case 'tables':
                    result = await this.schemaService.getTables(database, schema);
                    break;
                case 'views':
                    result = await this.schemaService.getViews(database, schema);
                    break;
                case 'functions':
                    result = await this.schemaService.getFunctions(database, schema);
                    break;
                case 'sequences':
                    result = await this.schemaService.getSequences(database, schema);
                    break;
                case 'columns':
                    result = await this.schemaService.getColumns(database, schema, containerItem.metadata.tableName);
                    // Add parentType to column metadata to distinguish table columns from view columns
                    result.forEach(col => {
                        if (col.metadata) {
                            col.metadata.parentType = containerItem.metadata.parentType;
                        }
                    });
                    break;
                case 'indexes':
                    result = await this.schemaService.getIndexes(database, schema, containerItem.metadata.tableName);
                    break;
                case 'constraints':
                    // Fetch both foreign keys and other constraints (CHECK, UNIQUE, EXCLUSION)
                    const foreignKeys = await this.schemaService.getForeignKeys(database, schema, containerItem.metadata.tableName);
                    const constraints = await this.schemaService.getConstraints(database, schema, containerItem.metadata.tableName);
                    result = [...foreignKeys, ...constraints];
                    break;
                case 'triggers':
                    result = await this.schemaService.getTriggers(database, schema, containerItem.metadata.tableName);
                    break;
                case 'policies':
                    result = await this.schemaService.getPolicies(database, schema, containerItem.metadata.tableName);
                    break;
                default:
                    result = [];
            }
            
            console.log(`[SCHEMA VIEW] Container ${containerType} returned ${result.length} items:`, result.map(r => r.name));
            return result;
        } catch (error) {
            console.error('Error fetching container children:', error);
            return [];
        }
    }

    private async getRoles(): Promise<SchemaItem[]> {
        try {
            // Get current database for connection (roles are cluster-wide, so any DB works)
            const viewData = await this.stateService.getViewData();
            const database = viewData.selectedDatabase || 'postgres';
            
            const sqlService = new (require('./services/sqlQuery.service').SqlQueryService)(this.stateService, (this as any).context);
            const result = await sqlService.executeQuery(`
                SELECT 
                    r.rolname as name,
                    r.rolsuper as is_superuser,
                    r.rolcreatedb as can_create_db,
                    r.rolcreaterole as can_create_role,
                    r.rolcanlogin as can_login,
                    ARRAY(
                        SELECT m.rolname 
                        FROM pg_auth_members am
                        JOIN pg_roles m ON am.roleid = m.oid
                        WHERE am.member = r.oid
                    ) as member_of
                FROM pg_catalog.pg_roles r
                WHERE r.rolname NOT LIKE 'pg_%'
                  AND r.rolname NOT IN ('cloud_admin', 'neon_superuser')
                ORDER BY r.rolname
            `, database);

            return result.rows.map((row: any) => {
                // Parse member_of array (PostgreSQL returns it as a string like "{role1,role2}")
                let memberOfArray: string[] = [];
                if (row.member_of) {
                    if (Array.isArray(row.member_of)) {
                        memberOfArray = row.member_of;
                    } else if (typeof row.member_of === 'string') {
                        // Parse PostgreSQL array format: "{role1,role2}" -> ["role1", "role2"]
                        const match = row.member_of.match(/^\{(.*)\}$/);
                        if (match && match[1]) {
                            memberOfArray = match[1].split(',').filter((s: string) => s.trim());
                        }
                    }
                }
                
                console.log(`Role ${row.name}: member_of raw =`, row.member_of, 'parsed =', memberOfArray);
                
                return {
                    id: `role_cluster_${row.name}`,
                    name: row.name,
                    type: 'role' as any,
                    metadata: {
                        is_superuser: row.is_superuser,
                        can_create_db: row.can_create_db,
                        can_create_role: row.can_create_role,
                        can_login: row.can_login,
                        member_of: memberOfArray
                    }
                };
            });
        } catch (error) {
            console.error('Error fetching roles:', error);
            return [];
        }
    }

    private async getTableContainers(database: string, schema: string, tableName: string, itemType: string): Promise<SchemaItem[]> {
        // Create container nodes for organizing table objects
        const baseId = `${database}_${schema}_${tableName}`;

        const containers: SchemaItem[] = [
            {
                id: `container_columns_${baseId}`,
                name: 'Columns',
                type: 'container' as any,
                metadata: { containerType: 'columns', database, schema, tableName, parentType: itemType }
            }
        ];

        // Only tables have indexes, constraints, and triggers
        if (itemType === 'table') {
            containers.push(
                {
                    id: `container_indexes_${baseId}`,
                    name: 'Indexes',
                    type: 'container' as any,
                    metadata: { containerType: 'indexes', database, schema, tableName }
                },
                {
                    id: `container_constraints_${baseId}`,
                    name: 'Constraints',
                    type: 'container' as any,
                    metadata: { containerType: 'constraints', database, schema, tableName }
                },
                {
                    id: `container_triggers_${baseId}`,
                    name: 'Triggers',
                    type: 'container' as any,
                    metadata: { containerType: 'triggers', database, schema, tableName }
                },
                {
                    id: `container_policies_${baseId}`,
                    name: 'Policies',
                    type: 'container' as any,
                    metadata: { containerType: 'policies', database, schema, tableName }
                }
            );
        }

        return containers;
    }

    private async getTablesAndFunctions(database: string, schema: string): Promise<SchemaItem[]> {
        try {
            const [tables, views, functions, sequences] = await Promise.all([
                this.schemaService.getTables(database, schema),
                this.schemaService.getViews(database, schema),
                this.schemaService.getFunctions(database, schema),
                this.schemaService.getSequences(database, schema)
            ]);
            return [...tables, ...views, ...functions, ...sequences];
        } catch (error) {
            console.error('Error fetching tables, views, functions, and sequences:', error);
            return [];
        }
    }

    private async preloadAllSchemaData(): Promise<void> {
        try {
            console.debug('Schema view: Starting preload of all schema data...');
            
            // Check if we're still connected and container is ready
            const viewData = await this.stateService.getViewData();
            if (!viewData.connected) {
                console.debug('Schema view: Aborting preload - not connected');
                return;
            }

            // Add a small delay to let the container fully stabilize
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Load connection children (databases container + roles container) first with timeout
            const connectionChildren = await Promise.race([
                this.getConnectionChildren(),
                new Promise<SchemaItem[]>((_, reject) => 
                    setTimeout(() => reject(new Error('Connection loading timeout')), 10000)
                )
            ]);
            
            // Cache connection children (includes databases container + roles container)
            this.schemaCache.set('connection_root', connectionChildren);
            
            // Preload roles for the roles container
            const rolesContainer = connectionChildren.find(item => item.type === 'container' && item.metadata?.containerType === 'roles');
            if (rolesContainer) {
                try {
                    const roles = await this.getRoles();
                    this.schemaCache.set(rolesContainer.id, roles);
                    console.debug(`Schema view: Cached ${roles.length} roles`);
                } catch (error) {
                    console.error('Error preloading roles:', error);
                }
            }
            
            // Preload databases for the databases container
            const databasesContainer = connectionChildren.find(item => item.type === 'container' && item.metadata?.containerType === 'databases');
            if (databasesContainer) {
                try {
                    const databases = await this.getDatabases();
                    this.schemaCache.set(databasesContainer.id, databases);
                    console.debug(`Schema view: Cached ${databases.length} databases`);
            
            // Don't preload if there are too many databases (performance consideration)
            if (databases.length > 10) {
                        console.debug(`Schema view: Skipping schema preload due to large number of databases (${databases.length})`);
                return;
            }
            
                    // For each database, preload the schemas container and its schemas
            for (const database of databases) {
                try {
                            // Create schemas container for this database
                            const schemasContainer: SchemaItem = {
                                id: `container_schemas_${database.name}`,
                                name: 'Schemas',
                                type: 'container' as any,
                                metadata: { containerType: 'schemas', database: database.name }
                            };
                            
                            // Cache the schemas container
                            this.schemaCache.set(database.id, [schemasContainer]);
                            
                            // Load schemas for the schemas container
                    const schemas = await this.getSchemas(database.name);
                    
                    // Don't preload if there are too many schemas in this database
                    if (schemas.length > 20) {
                        console.debug(`Schema view: Skipping preload for database ${database.name} due to large number of schemas (${schemas.length})`);
                        continue;
                    }
                    
                            // Cache schemas under the schemas container ID
                            this.schemaCache.set(schemasContainer.id, schemas);
                    
                    // For each schema, load container structure
                    for (const schema of schemas) {
                        try {
                            const parts = schema.id.split('_');
                            const dbName = parts[1] === 'v2' ? parts[2] : parts[1];
                            const schemaName = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');
                            
                            // Cache schema containers (Tables, Views, Functions, Sequences)
                            const containers = await this.getSchemaContainers(schema);
                            this.schemaCache.set(schema.id, containers);
                            
                            // Now preload the actual tables, views, functions, sequences for each container
                            for (const container of containers) {
                                const { containerType, database, schema: schemaName } = container.metadata;
                                try {
                                    let containerChildren: SchemaItem[] = [];
                                    switch (containerType) {
                                        case 'tables':
                                            containerChildren = await this.schemaService.getTables(database, schemaName);
                                            break;
                                        case 'views':
                                            containerChildren = await this.schemaService.getViews(database, schemaName);
                                            break;
                                        case 'functions':
                                            containerChildren = await this.schemaService.getFunctions(database, schemaName);
                                            break;
                                        case 'sequences':
                                            containerChildren = await this.schemaService.getSequences(database, schemaName);
                                            break;
                                    }
                                    
                                    // Don't preload table details if there are too many items
                                    if (containerChildren.length > 50) {
                                        console.debug(`Schema view: Skipping ${containerType} detail preload for schema ${schemaName} due to large number (${containerChildren.length})`);
                                        // Still cache the container's children list
                                        this.schemaCache.set(container.id, containerChildren);
                                        continue;
                                    }
                                    
                                    // Cache container children
                                    this.schemaCache.set(container.id, containerChildren);
                                } catch (error) {
                                    console.error(`Error preloading ${containerType} for schema ${schemaName}:`, error);
                                }
                            }
                            
                            // Get all tables for detailed preload
                            const tablesAndFunctions = await this.getTablesAndFunctions(dbName, schemaName);
                            if (tablesAndFunctions.length > 50) {
                                console.debug(`Schema view: Skipping table detail preload for schema ${schemaName} due to large number of tables (${tablesAndFunctions.length})`);
                                continue;
                            }
                            
                            // For each table/view, load container nodes (Columns, Indexes, Constraints, Triggers)
                            const tablePromises = tablesAndFunctions
                                .filter(item => item.type === 'table' || item.type === 'view')
                                .map(async (tableItem) => {
                                    try {
                                        // Parse using parent to handle underscores in schema names correctly
                                        let tableDatabase: string;
                                        let tableSchema: string;
                                        let tableName: string;
                                        
                                        if (tableItem.parent) {
                                            const parentParts = tableItem.parent.split('_');
                                            // parent format: schema_v2_database_schema...
                                            tableDatabase = parentParts[2];
                                            tableSchema = parentParts.slice(3).join('_');
                                            // Extract table name from ID
                                            const prefix = `${tableItem.type}_${tableDatabase}_${tableSchema}_`;
                                            tableName = tableItem.id.substring(prefix.length);
                                        } else {
                                            // Fallback to old parsing
                                            const tableParts = tableItem.id.split('_');
                                            tableDatabase = tableParts[1];
                                            tableSchema = tableParts[2];
                                            tableName = tableParts.slice(3).join('_');
                                        }
                                        
                                        // Use getTableContainers to get the new container structure
                                        const tableContainers = await this.getTableContainers(tableDatabase, tableSchema, tableName, tableItem.type);
                                        
                                        // Cache table containers
                                        this.schemaCache.set(tableItem.id, tableContainers);
                                    } catch (error) {
                                        console.error(`Error preloading table containers for ${tableItem.name}:`, error);
                                    }
                                });
                            
                            // Execute table preloading in parallel but limit concurrency
                            const batchSize = 3; // Process 3 tables at a time to avoid overwhelming the database
                            for (let i = 0; i < tablePromises.length; i += batchSize) {
                                const batch = tablePromises.slice(i, i + batchSize);
                                await Promise.all(batch);
                            }
                            
                        } catch (error) {
                            console.error(`Error preloading schema ${schema.name}:`, error);
                        }
                    }
                } catch (error) {
                    console.error(`Error preloading database ${database.name}:`, error);
                        }
                    }
                } catch (error) {
                    console.error('Error preloading databases container:', error);
                }
            }
            
            console.debug('Schema view: Preload completed successfully');
            
            // Don't auto-refresh tree view - data will be available when manually refreshed
            
        } catch (error) {
            console.error('Error during schema preload:', error);
        }
    }
}

export class SchemaViewProvider {
    private treeDataProvider: SchemaTreeProvider;
    private treeView: vscode.TreeView<SchemaItem>;
    private lastConnectionState: boolean = false;
    private lastConnectedBranch: string = '';
    private schemaService: SchemaService;

    constructor(
        private context: vscode.ExtensionContext,
        private stateService: StateService,
        private authManager: AuthManager,
        private dockerService: DockerService
    ) {
        this.schemaService = new SchemaService(stateService, context);
        this.treeDataProvider = new SchemaTreeProvider(this.schemaService, stateService, authManager, dockerService);
        
        this.treeView = vscode.window.createTreeView('neonLocalSchema', {
            treeDataProvider: this.treeDataProvider,
            showCollapseAll: true
        });

        this.registerCommands();
        this.setupEventListeners();
    }

    /**
     * Parse schema/table/view/function identifiers from SchemaItem
     * Uses parent field when available to handle underscores in names
     */
    private parseSchemaItem(item: SchemaItem): { database: string; schema: string; name: string } {
        // Use item.name directly for the entity name
        const name = item.name;
        
        // Parse parent to get database and schema
        if (item.parent) {
            const parentParts = item.parent.split('_');
            
            // Handle schema_v2_database_schema format
            if (parentParts[0] === 'schema' && parentParts[1] === 'v2') {
                return {
                    database: parentParts[2],
                    schema: parentParts.slice(3).join('_'), // Handle underscores in schema
                    name
                };
            }
            // Handle old schema_database_schema format
            else if (parentParts[0] === 'schema') {
                return {
                    database: parentParts[1],
                    schema: parentParts.slice(2).join('_'), // Handle underscores in schema
                    name
                };
            }
        }
        
        // Fallback: parse from ID (less reliable for names with underscores)
        const parts = item.id.split('_');
        const type = parts[0];
        
        if (type === 'schema') {
            const isV2 = parts[1] === 'v2';
            return {
                database: isV2 ? parts[2] : parts[1],
                schema: isV2 ? parts.slice(3).join('_') : parts.slice(2).join('_'),
                name
            };
        } else {
            // table, view, function, index, etc.: type_database_schema_name
            return {
                database: parts[1],
                schema: parts[2],
                name: parts.slice(3).join('_') // Handle underscores in entity name
            };
        }
    }

    private registerCommands(): void {
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.schema.refresh', () => {
                console.debug('Schema view: Manual refresh triggered');
                this.treeDataProvider.refresh();
            }),
            vscode.commands.registerCommand('neonLocal.schema.showDetails', (item: SchemaItem) => {
                this.showItemDetails(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.showContextMenu', (item: SchemaItem) => {
                this.showContextMenu(item);
            }),

            vscode.commands.registerCommand('neonLocal.schema.openSqlQuery', () => {
                this.openSqlQuery();
            }),
            vscode.commands.registerCommand('neonLocal.schema.queryTable', (item: SchemaItem) => {
                this.queryTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.viewTableData', (item: SchemaItem) => {
                this.viewTableData(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.resetFromParent', () => {
                this.resetFromParent();
            }),
            vscode.commands.registerCommand('neonLocal.schema.launchPsql', (item: SchemaItem) => {
                this.launchPsql(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.truncateTable', (item: SchemaItem) => {
                this.truncateTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropTable', (item: SchemaItem) => {
                this.dropTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createTable', (item: SchemaItem) => {
                this.createTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editTable', (item: SchemaItem) => {
                this.editTable(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createSchema', (item: SchemaItem) => {
                this.createSchema(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editSchema', (item: SchemaItem) => {
                this.editSchema(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropSchema', (item: SchemaItem) => {
                this.dropSchema(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.showSchemaProperties', (item: SchemaItem) => {
                this.showSchemaProperties(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createIndex', (item: SchemaItem) => {
                this.createIndex(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.manageIndexes', (item: SchemaItem) => {
                this.manageIndexes(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropIndex', (item: SchemaItem) => {
                this.dropIndex(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.reindexIndex', (item: SchemaItem) => {
                this.reindexIndex(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createView', (item: SchemaItem) => {
                this.createView(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editView', (item: SchemaItem) => {
                this.editView(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropView', (item: SchemaItem) => {
                this.dropView(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.refreshMaterializedView', (item: SchemaItem) => {
                this.refreshMaterializedView(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createDatabase', (item: SchemaItem) => {
                this.createDatabase(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropDatabase', (item: SchemaItem) => {
                this.dropDatabase(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.showUsers', (item: SchemaItem) => {
                this.showUsers(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createUser', (item: SchemaItem) => {
                this.createUser(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropUser', (item: SchemaItem) => {
                this.dropUser(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.changePassword', (item: SchemaItem) => {
                this.changePassword(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.resetRolePassword', (item: SchemaItem) => {
                this.resetRolePassword(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editRole', (item: SchemaItem) => {
                this.editRole(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.manageRolePermissions', (item: SchemaItem) => {
                this.manageRolePermissions(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropRole', (item: SchemaItem) => {
                this.dropRole(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.managePermissions', (item: SchemaItem) => {
                this.managePermissions(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.importData', (item: SchemaItem) => {
                this.importData(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.exportData', (item: SchemaItem) => {
                this.exportData(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createFunction', (item: SchemaItem) => {
                this.createFunction(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editFunction', (item: SchemaItem) => {
                this.editFunction(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropFunction', (item: SchemaItem) => {
                this.dropFunction(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createSequence', (item: SchemaItem) => {
                this.createSequence(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.alterSequence', (item: SchemaItem) => {
                this.alterSequence(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropSequence', (item: SchemaItem) => {
                this.dropSequence(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.restartSequence', (item: SchemaItem) => {
                this.restartSequence(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.setSequenceValue', (item: SchemaItem) => {
                this.setSequenceValue(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createForeignKey', (item: SchemaItem) => {
                this.createForeignKey(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.viewForeignKeyProperties', (item: SchemaItem) => {
                this.viewForeignKeyProperties(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropForeignKey', (item: SchemaItem) => {
                this.dropForeignKey(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createConstraint', (item: SchemaItem) => {
                this.createConstraint(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropConstraint', (item: SchemaItem) => {
                this.dropConstraint(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editConstraint', (item: SchemaItem) => {
                this.editConstraint(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createTrigger', (item: SchemaItem) => {
                this.createTrigger(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.viewTriggerProperties', (item: SchemaItem) => {
                this.viewTriggerProperties(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editTrigger', (item: SchemaItem) => {
                this.editTrigger(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.enableTrigger', (item: SchemaItem) => {
                this.enableTrigger(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.disableTrigger', (item: SchemaItem) => {
                this.disableTrigger(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropTrigger', (item: SchemaItem) => {
                this.dropTrigger(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createPolicy', (item: SchemaItem) => {
                this.createPolicy(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editPolicy', (item: SchemaItem) => {
                this.editPolicy(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropPolicy', (item: SchemaItem) => {
                this.dropPolicy(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.createColumn', (item: SchemaItem) => {
                this.createColumn(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.editColumn', (item: SchemaItem) => {
                this.editColumn(item);
            }),
            vscode.commands.registerCommand('neonLocal.schema.dropColumn', (item: SchemaItem) => {
                this.dropColumn(item);
            }),
            vscode.commands.registerCommand('neonLocal.orm.generateModel', (item: SchemaItem) => {
                this.generateModel(item);
            })
        );
    }

    private setupEventListeners(): void {
        // Register a command to listen for connection state changes
        this.context.subscriptions.push(
            vscode.commands.registerCommand('neonLocal.schema.onConnectionStateChanged', async (viewData) => {
                const wasConnectedBefore = this.lastConnectionState;
                const isConnectedNow = viewData?.connected || false;
                const currentBranch = viewData?.currentlyConnectedBranch || '';
                const branchChanged = currentBranch !== this.lastConnectedBranch;
                
                console.debug('Schema view: Connection state changed', {
                    wasConnectedBefore,
                    isConnectedNow,
                    lastBranch: this.lastConnectedBranch,
                    currentBranch,
                    branchChanged
                });
                
                // Update the last known states
                this.lastConnectionState = isConnectedNow;
                this.lastConnectedBranch = currentBranch;
                
                // Handle connection state changes
                if (isConnectedNow && (!wasConnectedBefore || branchChanged)) {
                    console.debug('Schema view: New connection or branch change - forcing aggressive refresh');
                    // Use force refresh to ensure complete cache clear and tree update
                    this.treeDataProvider.forceRefresh();
                } else if (wasConnectedBefore && !isConnectedNow) {
                    console.debug('Schema view: Connection lost - clearing all caches');
                    this.treeDataProvider.clearCache();
                    this.treeDataProvider.refresh();
                }
            })
        );

        // Store initial connection state and refresh if already connected
        this.stateService.getViewData().then(viewData => {
            this.lastConnectionState = viewData.connected;
            this.lastConnectedBranch = viewData.currentlyConnectedBranch || '';
            console.debug('Schema view: Initial state stored', { 
                connected: viewData.connected, 
                branch: this.lastConnectedBranch 
            });
            
            // If already connected on startup, refresh to show current branch data
            if (viewData.connected) {
                console.debug('Schema view: Already connected on startup - force refreshing with current branch data');
                this.treeDataProvider.forceRefresh();
            }
        });
    }

    private showItemDetails(item: SchemaItem): void {
        const details = this.formatItemDetails(item);
        vscode.window.showInformationMessage(details, { modal: false });
    }

    private formatItemDetails(item: SchemaItem): string {
        switch (item.type) {
            case 'database':
                return `Database: ${item.name}${item.metadata?.size ? `\nSize: ${item.metadata.size}` : ''}`;
            case 'schema':
                return `Schema: ${item.name}\nOwner: ${item.metadata?.owner || 'Unknown'}`;
            case 'table':
                return `Table: ${item.name}\nType: ${item.metadata?.table_type || 'Unknown'}\nSize: ${item.metadata?.size || 'Unknown'}`;
            case 'view':
                return `View: ${item.name}\nType: ${item.metadata?.table_type || 'Unknown'}`;
            case 'column':
                const col = item.metadata;
                let details = `Column: ${item.name}\nType: ${col?.data_type || 'Unknown'}`;
                if (col?.character_maximum_length) details += `(${col.character_maximum_length})`;
                details += `\nNullable: ${col?.is_nullable ? 'Yes' : 'No'}`;
                if (col?.column_default) details += `\nDefault: ${col.column_default}`;
                if (col?.is_primary_key) details += '\nPrimary Key: Yes';
                if (col?.is_foreign_key) details += `\nForeign Key: ${col.foreign_table}.${col.foreign_column}`;
                return details;
            case 'index':
                const idx = item.metadata;
                let indexDetails = `Index: ${item.name}`;
                if (idx?.is_primary) indexDetails += '\nType: Primary Key';
                else if (idx?.is_unique) indexDetails += '\nType: Unique';
                else indexDetails += '\nType: Regular';
                if (idx?.definition) indexDetails += `\nDefinition: ${idx.definition}`;
                return indexDetails;
            case 'function':
                const func = item.metadata;
                return `Function: ${item.name}\nParameters: ${func?.parameters || 'None'}\nReturn Type: ${func?.return_type || 'void'}`;
            case 'trigger':
                const trigger = item.metadata;
                return `Trigger: ${item.name}\nEvent: ${trigger?.event || 'Unknown'}\nTiming: ${trigger?.timing || 'Unknown'}`;
            default:
                return `${item.type}: ${item.name}`;
        }
    }



    private openSqlQuery(): void {
        SqlQueryPanel.createOrShow(this.context, this.stateService);
    }

    private queryTable(item: SchemaItem): void {
        if (item.type !== 'table' && item.type !== 'view') {
            return;
        }

        // Parse ID more carefully: table_database_schema_tablename
        // Since table names can contain underscores, we need to split more carefully
        const { database, schema, name: tableName } = this.parseSchemaItem(item);
        
        // Debug logging
        console.debug('QueryTable - Item ID:', item.id);
        console.debug('QueryTable - Database:', database, 'Schema:', schema, 'Table:', tableName);
        
        const query = `SELECT *\nFROM ${schema}.${tableName}\nLIMIT 100;`;
        console.debug('QueryTable - Generated query:', query);
        
        SqlQueryPanel.createOrShow(this.context, this.stateService, query, database);
    }

    private viewTableData(item: SchemaItem): void {
        if (item.type !== 'table') {
            return;
        }

        // Parse using parent to handle underscores in schema names correctly
        let database: string;
        let schema: string;
        let tableName: string;
        
        if (item.parent) {
            const parentParts = item.parent.split('_');
            // parent format: schema_v2_database_schema...
            database = parentParts[2];
            schema = parentParts.slice(3).join('_');
            // Extract table name from ID
            const prefix = `table_${database}_${schema}_`;
            tableName = item.id.substring(prefix.length);
        } else {
            // Fallback to old parsing
            const parts = item.id.split('_');
            database = parts[1];
            schema = parts[2];
            tableName = parts.slice(3).join('_');
        }
        
        // Debug logging
        console.debug('ViewTableData - Item ID:', item.id);
        console.debug('ViewTableData - Database:', database, 'Schema:', schema, 'Table:', tableName);
        
        TableDataPanel.createOrShow(this.context, this.stateService, schema, tableName, database);
    }

    private async resetFromParent(): Promise<void> {
        // Call the existing global reset command to ensure consistent behavior
        await vscode.commands.executeCommand('neon-local-connect.resetFromParent');
    }

    private async launchPsql(item: SchemaItem): Promise<void> {
        if (item.type !== 'database') {
            return;
        }

        try {
            // Get the current view data to get proxy port
            const viewData = await this.stateService.getViewData();
            
            if (!viewData.connected) {
                throw new Error('Database is not connected. Please connect first.');
            }

            const database = item.name;
            const port = viewData.port;
            
            // Use the local proxy credentials (from ConnectionPoolService)
            const connectionString = `postgres://neon:npg@localhost:${port}/${database}`;

            // Launch PSQL with the local proxy connection string
            const terminal = vscode.window.createTerminal(`Neon PSQL - ${database}`);
            terminal.show();
            terminal.sendText(`psql "${connectionString}"`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to launch PSQL: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async truncateTable(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename
            const { database, schema, name: tableName } = this.parseSchemaItem(item);

            // Show confirmation dialog
            const confirmMessage = `Are you sure you want to truncate table "${schema}.${tableName}"? This action will remove all data from the table and cannot be undone.`;
            
            const answer = await vscode.window.showWarningMessage(
                confirmMessage,
                { modal: true },
                'Truncate'
            );

            if (answer !== 'Truncate') {
                return;
            }

            // Execute truncate command
            const query = `TRUNCATE TABLE ${schema}.${tableName}`;
            await this.schemaService.testConnection(database); // Ensure connection
            
            // Use the schema service connection pool to execute the truncate
            const connectionPool = (this.schemaService as any).connectionPool;
            await connectionPool.executeQuery(query, [], database);

            vscode.window.showInformationMessage(`Table "${schema}.${tableName}" has been truncated successfully.`);
            
            // Refresh the schema view to reflect any changes
            this.treeDataProvider.refresh();
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to truncate table: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropTable(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename  
            const { database, schema, name: tableName } = this.parseSchemaItem(item);

            // Show confirmation dialog with stronger warning
            const confirmMessage = `Are you sure you want to DROP table "${schema}.${tableName}"? This action will permanently delete the table and all its data. This cannot be undone.`;
            
            const answer = await vscode.window.showErrorMessage(
                confirmMessage,
                { modal: true },
                'Drop Table'
            );

            if (answer !== 'Drop Table') {
                return;
            }

            // Execute drop command
            const query = `DROP TABLE "${schema}"."${tableName}"`;
            await this.schemaService.testConnection(database); // Ensure connection
            
            // Use the schema service connection pool to execute the drop
            const connectionPool = (this.schemaService as any).connectionPool;
            await connectionPool.executeQuery(query, [], database);

            vscode.window.showInformationMessage(`Table "${schema}.${tableName}" has been dropped successfully.`);
            
            // Refresh the schema view to reflect the removal
            this.treeDataProvider.refresh();
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop table: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createTable(item: SchemaItem): Promise<void> {
        // Can be called on schema, database, or container items
        if (item.type !== 'schema' && item.type !== 'database' && item.type !== 'container') {
            return;
        }

        try {
            // Parse the ID to get database and schema
            let database: string;
            let schema: string;

            if (item.type === 'container') {
                // For container (Tables node), get from metadata
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
            } else if (item.type === 'schema') {
                // Parse schema ID: schema_v2_database_schemaname or schema_database_schemaname (old format)
                const parts = item.id.split('_');
                database = parts[1] === 'v2' ? parts[2] : parts[1];
                schema = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');
            } else {
                // For database, default to public schema
                database = item.name;
                schema = 'public';
            }

            // Open the create table panel
            CreateTablePanel.createOrShow(this.context, this.stateService, schema, database);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open create table dialog: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editTable(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            const { database, schema, name: tableName } = this.parseSchemaItem(item);
            EditTablePanel.createOrShow(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open edit table dialog: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createSchema(item: SchemaItem): Promise<void> {
        // Can be called on database items or schemas container
        if (item.type !== 'database' && item.type !== 'container') {
            return;
        }

        try {
            let database: string;
            if (item.type === 'database') {
                database = item.name;
            } else if (item.type === 'container' && item.metadata?.containerType === 'schemas') {
                database = item.metadata.database;
            } else {
            return;
        }

            await SchemaManagementPanel.createSchema(this.context, this.stateService, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create schema: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editSchema(item: SchemaItem): Promise<void> {
        if (item.type !== 'schema') {
            return;
        }

        try {
            // Parse schema ID: schema_v2_database_schemaname or schema_database_schemaname (old format)
            const parts = item.id.split('_');
            const database = parts[1] === 'v2' ? parts[2] : parts[1];
            const schemaName = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');

            await SchemaManagementPanel.editSchema(this.context, this.stateService, schemaName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit schema: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropSchema(item: SchemaItem): Promise<void> {
        if (item.type !== 'schema') {
            return;
        }

        try {
            // Parse schema ID: schema_v2_database_schemaname or schema_database_schemaname (old format)
            const parts = item.id.split('_');
            const database = parts[1] === 'v2' ? parts[2] : parts[1];
            const schemaName = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');

            await SchemaManagementPanel.dropSchema(this.context, this.stateService, schemaName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop schema: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async showSchemaProperties(item: SchemaItem): Promise<void> {
        if (item.type !== 'schema') {
            return;
        }

        try {
            // Parse schema ID: schema_v2_database_schemaname or schema_database_schemaname (old format)
            const parts = item.id.split('_');
            const database = parts[1] === 'v2' ? parts[2] : parts[1];
            const schemaName = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');

            await SchemaManagementPanel.showSchemaProperties(this.context, this.stateService, schemaName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show schema properties: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createIndex(item: SchemaItem): Promise<void> {
        if (item.type !== 'table' && item.type !== 'container') {
            return;
        }

        try {
            let database: string;
            let schema: string;
            let tableName: string;

            if (item.type === 'container') {
                // Called from indexes container
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
                tableName = item.metadata?.tableName || '';
            } else {
                // Called from table - parse using parent to handle underscores in schema names
                if (item.parent) {
                    const parentParts = item.parent.split('_');
                    database = parentParts[2];
                    schema = parentParts.slice(3).join('_');
                    const prefix = `table_${database}_${schema}_`;
                    tableName = item.id.substring(prefix.length);
                } else {
                    // Fallback
                    const parts = item.id.split('_');
                    database = parts[1];
                    schema = parts[2];
                    tableName = parts.slice(3).join('_');
                }
            }

            await IndexManagementPanel.createIndex(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create index: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async manageIndexes(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename
            const { database, schema, name: tableName } = this.parseSchemaItem(item);

            await IndexManagementPanel.manageIndexes(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to manage indexes: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private dropIndex = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'index') {
            return;
        }

        // Don't allow dropping primary key indexes
        if (item.metadata?.is_primary) {
            vscode.window.showErrorMessage('Cannot drop primary key indexes. Drop the primary key constraint from the table instead.');
            return;
        }

        try {
            // Use metadata which includes schema, database, and tableName
            const database = item.metadata?.database;
            const schema = item.metadata?.schema;
            const indexName = item.name; // Use the name directly as it's the index name
            
            if (!database || !schema) {
                throw new Error('Unable to determine database and schema for index');
            }

            // Confirm before dropping
            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to drop index "${indexName}"?`,
                { modal: true },
                'Drop Index'
            );

            if (confirm !== 'Drop Index') {
                return;
            }

            await IndexManagementPanel.dropIndex(this.context, this.stateService, schema, indexName, false, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop index: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private reindexIndex = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'index') {
            return;
        }

        try {
            // Use metadata which includes schema, database, and tableName
            const database = item.metadata?.database;
            const schema = item.metadata?.schema;
            const indexName = item.name; // Use the name directly as it's the index name
            
            if (!database || !schema) {
                throw new Error('Unable to determine database and schema for index');
            }

            await IndexManagementPanel.reindexIndex(this.context, this.stateService, schema, indexName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to rebuild index: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private async createView(item: SchemaItem): Promise<void> {
        if (item.type !== 'schema' && item.type !== 'database' && item.type !== 'container') {
            return;
        }

        try {
            let schema: string;
            let database: string;

            if (item.type === 'container') {
                // For container (Views node), get from metadata
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
            } else if (item.type === 'schema') {
                // Parse schema ID: schema_v2_database_schemaname or schema_database_schemaname (old format)
                const parts = item.id.split('_');
                database = parts[1] === 'v2' ? parts[2] : parts[1];
                schema = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');
            } else {
                // Database selected, use public schema by default
                database = item.name;
                schema = 'public';
            }

            await ViewManagementPanel.createView(this.context, this.stateService, schema, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create view: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editView(item: SchemaItem): Promise<void> {
        if (item.type !== 'view') {
            return;
        }

        try {
            // Parse view ID: view_database_schema_viewname
            const { database, schema, name: viewName } = this.parseSchemaItem(item);

            await ViewManagementPanel.editView(this.context, this.stateService, schema, viewName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit view: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropView(item: SchemaItem): Promise<void> {
        if (item.type !== 'view') {
            return;
        }

        try {
            // Parse view ID: view_database_schema_viewname
            const { database, schema, name: viewName } = this.parseSchemaItem(item);

            // Check if it's a materialized view
            const isMaterialized = item.metadata?.is_materialized || false;
            const viewType = isMaterialized ? 'materialized view' : 'view';

            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop ${viewType} "${viewName}"?`,
                { modal: true },
                'Drop (RESTRICT)',
                'Drop (CASCADE)'
            );

            if (!confirmation) {
                return;
            }

            const cascade = confirmation.includes('CASCADE');
            await ViewManagementPanel.dropView(this.context, this.stateService, schema, viewName, isMaterialized, cascade, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop view: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async refreshMaterializedView(item: SchemaItem): Promise<void> {
        if (item.type !== 'view') {
            return;
        }

        try {
            // Parse view ID: view_database_schema_viewname
            const { database, schema, name: viewName } = this.parseSchemaItem(item);

            // Check if it's a materialized view
            if (!item.metadata?.is_materialized) {
                vscode.window.showWarningMessage('This is not a materialized view. Only materialized views can be refreshed.');
                return;
            }

            // Use standard (non-concurrent) refresh by default
            // Concurrent refresh requires a unique index and is rarely needed for most use cases
            await ViewManagementPanel.refreshMaterializedView(this.context, this.stateService, schema, viewName, false, database);
        } catch (error) {
            // Error is already shown in ViewManagementPanel.refreshMaterializedView
            console.error('Error refreshing materialized view:', error);
        }
    }

    private async showUsers(item: SchemaItem): Promise<void> {
        if (item.type !== 'database') {
            return;
        }

        try {
            const database = item.name;
            await UserManagementPanel.showUsers(this.context, this.stateService, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show users: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createUser(item: SchemaItem): Promise<void> {
        // Accept both database and container (for Roles container)
        if (item.type !== 'database' && item.type !== 'container') {
            return;
        }

        try {
            // For container type (Roles container), use undefined database
            // For database type, use the database name
            const database = item.type === 'database' ? item.name : undefined;
            await UserManagementPanel.createUser(this.context, this.stateService, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create user: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async importData(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename
            const { database, schema, name: tableName } = this.parseSchemaItem(item);

            await DataImportExportPanel.showImport(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show import interface: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async exportData(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename
            const { database, schema, name: tableName } = this.parseSchemaItem(item);

            await DataImportExportPanel.showExport(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show export interface: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createFunction(item: SchemaItem): Promise<void> {
        if (item.type !== 'schema' && item.type !== 'container' && item.type !== 'database') {
            return;
        }

        try {
            let database: string;
            let schema: string;

            if (item.type === 'container') {
                // For container (Functions node), get from metadata
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
            } else if (item.type === 'database') {
                // For database, default to public schema
                database = item.name;
                schema = 'public';
            } else {
                // Parse schema ID: schema_v2_database_schemaname or schema_database_schemaname (old format)
            const parts = item.id.split('_');
                database = parts[1] === 'v2' ? parts[2] : parts[1];
                schema = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');
            }

            await FunctionManagementPanel.createFunction(this.context, this.stateService, schema, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create function: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editFunction(item: SchemaItem): Promise<void> {
        if (item.type !== 'function') {
            return;
        }

        try {
            // Parse function ID: function_database_schema_functionname
            const { database, schema, name: functionName } = this.parseSchemaItem(item);

            await FunctionManagementPanel.editFunction(this.context, this.stateService, schema, functionName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit function: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropFunction(item: SchemaItem): Promise<void> {
        if (item.type !== 'function') {
            return;
        }

        try {
            // Parse function ID: function_database_schema_functionname
            const { database, schema, name: functionName } = this.parseSchemaItem(item);

            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop function "${functionName}"?`,
                { modal: true },
                'Drop (RESTRICT)',
                'Drop (CASCADE)'
            );

            if (!confirmation) {
                return;
            }

            const cascade = confirmation.includes('CASCADE');
            await FunctionManagementPanel.dropFunction(this.context, this.stateService, schema, functionName, cascade, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop function: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getSchemaService(): SchemaService {
        return this.schemaService;
    }

    private async createDatabase(item: SchemaItem): Promise<void> {
        try {
            await DatabaseManagementPanel.createDatabase(this.context, this.stateService);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create database: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropDatabase(item: SchemaItem): Promise<void> {
        if (item.type !== 'database') {
            return;
        }

        try {
            // Parse database ID: database_databasename
            const parts = item.id.split('_');
            const database = parts.slice(1).join('_');
            await DatabaseManagementPanel.dropDatabase(this.context, this.stateService, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop database: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropUser(item: SchemaItem): Promise<void> {
        // Get username from quick input
        const username = await vscode.window.showInputBox({
            prompt: 'Enter username/role to drop',
            placeHolder: 'username',
            validateInput: (value) => {
                if (!value) {
                    return 'Username is required';
                }
                return null;
            }
        });

        if (!username) {
            return;
        }

        try {
            const database = item.type === 'database' ? item.id.split('_').slice(1).join('_') : undefined;
            
            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop user/role "${username}"?`,
                { modal: true, detail: 'This action cannot be undone.' },
                'Drop User/Role'
            );

            if (confirmation !== 'Drop User/Role') {
                return;
            }

            await UserManagementPanel.dropUser(this.context, this.stateService, username, database);
            vscode.window.showInformationMessage(`User/role "${username}" dropped successfully!`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop user: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async changePassword(item: SchemaItem): Promise<void> {
        if (item.type !== 'role') {
            return;
        }

        try {
            const username = item.name;
            const database = undefined; // Password changes are cluster-wide, not database-specific
            await UserManagementPanel.changePassword(this.context, this.stateService, username, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to change password: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async resetRolePassword(item: SchemaItem): Promise<void> {
        if (item.type !== 'role') {
            return;
        }

        const roleName = item.name;
        
        // Confirm the action
        const confirm = await vscode.window.showWarningMessage(
            `Reset password for role "${roleName}" via Neon API? A new password will be auto-generated.`,
            { modal: true },
            'Reset Password'
        );

        if (confirm !== 'Reset Password') {
            return;
        }

        try {
            // Get project and branch IDs
            const apiService = new (require('./services/api.service').NeonApiService)(this.context);
            
            let projectId = await this.stateService.getCurrentProjectId();
            let branchId = await this.stateService.getCurrentBranchId();
            
            // Fallback to viewData if not found
            if (!projectId || !branchId) {
                const viewData = await this.stateService.getViewData();
                projectId = projectId || viewData.connectedProjectId;
                branchId = branchId || viewData.currentlyConnectedBranch;
            }
            
            if (!projectId || !branchId) {
                throw new Error('Unable to determine project or branch. Please ensure you are connected to a Neon database.');
            }
            
            // Reset password via API
            const response = await apiService.resetRolePassword(projectId, branchId, roleName);
            const newPassword = response.role.password || '(password not provided)';
            
            // Copy to clipboard
            await vscode.env.clipboard.writeText(newPassword);
            
            // Show notification
            vscode.window.showInformationMessage(
                `✅ Password reset for "${roleName}"! New password copied to clipboard: ${newPassword}`
            );
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reset password: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editRole(item: SchemaItem): Promise<void> {
        if (item.type !== 'role') {
            return;
        }

        try {
            const roleName = item.name;
            const database = undefined; // Roles are cluster-wide
            await UserManagementPanel.editRole(this.context, this.stateService, roleName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit role: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async manageRolePermissions(item: SchemaItem): Promise<void> {
        if (item.type !== 'role') {
            return;
        }

        const roleName = item.name;
        
        try {
            const database = undefined; // Permissions are managed per database
            await UserManagementPanel.managePermissions(this.context, this.stateService, roleName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to manage permissions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async dropRole(item: SchemaItem): Promise<void> {
        if (item.type !== 'role') {
            return;
        }

        const roleName = item.name;
        const metadata = item.metadata;
        
        // Check if this is a neon_superuser member
        const memberOf = metadata?.member_of || [];
        const isNeonSuperuser = Array.isArray(memberOf) && memberOf.includes('neon_superuser');
        
        // Confirm the action
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to drop role "${roleName}"? This action cannot be undone.`,
            { modal: true },
            'Drop Role'
        );

        if (confirm !== 'Drop Role') {
            return;
        }

        try {
            if (isNeonSuperuser) {
                // Use Neon API for neon_superuser roles
                const apiService = new (require('./services/api.service').NeonApiService)(this.context);
                
                let projectId = await this.stateService.getCurrentProjectId();
                let branchId = await this.stateService.getCurrentBranchId();
                
                // Fallback to viewData if not found
                if (!projectId || !branchId) {
                    const viewData = await this.stateService.getViewData();
                    projectId = projectId || viewData.connectedProjectId;
                    branchId = branchId || viewData.currentlyConnectedBranch;
                }
                
                if (!projectId || !branchId) {
                    throw new Error('Unable to determine project or branch. Please ensure you are connected to a Neon database.');
                }
                
                // Drop role via API
                await apiService.deleteRole(projectId, branchId, roleName);
            } else {
                // Use SQL for non-neon_superuser roles
                const sqlService = new (require('./services/sqlQuery.service').SqlQueryService)(this.stateService, this.context);
                const database = 'postgres'; // Roles are cluster-wide, use any database
                
                // Properly quote the role name to handle special characters and reserved words
                await sqlService.executeQuery(`DROP ROLE IF EXISTS "${roleName}"`, database);
            }
            
            vscode.window.showInformationMessage(`Role "${roleName}" dropped successfully!`);
            
            // Refresh the tree
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
        } catch (error) {
            let errorMessage = 'Unknown error';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                // Handle PostgreSQL error objects
                const pgError = error as any;
                errorMessage = pgError.message || JSON.stringify(error, Object.getOwnPropertyNames(error));
            } else {
                errorMessage = String(error);
            }
            vscode.window.showErrorMessage(`Failed to drop role: ${errorMessage}`);
        }
    }

    private async managePermissions(item: SchemaItem): Promise<void> {
        // Get username from quick input
        const username = await vscode.window.showInputBox({
            prompt: 'Enter username to manage permissions for',
            placeHolder: 'username'
        });

        if (!username) {
            return;
        }

        try {
            const database = item.type === 'database' ? item.id.split('_').slice(1).join('_') : undefined;
            await UserManagementPanel.managePermissions(this.context, this.stateService, username, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to manage permissions: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createSequence(item: SchemaItem): Promise<void> {
        if (item.type !== 'schema' && item.type !== 'container' && item.type !== 'database') {
            return;
        }

        try {
            let database: string;
            let schema: string;

            if (item.type === 'container') {
                // For container (Sequences node), get from metadata
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
            } else if (item.type === 'database') {
                // For database, default to public schema
                database = item.name;
                schema = 'public';
            } else {
                // Parse schema ID: schema_v2_database_schemaname or schema_database_schemaname (old format)
                const parts = item.id.split('_');
                database = parts[1] === 'v2' ? parts[2] : parts[1];
                schema = parts[1] === 'v2' ? parts.slice(3).join('_') : parts.slice(2).join('_');
            }

            await SequenceManagementPanel.createSequence(this.context, this.stateService, schema, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create sequence: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async alterSequence(item: SchemaItem): Promise<void> {
        if (item.type !== 'sequence') {
            return;
        }

        try {
            // Parse parent schema ID to get database and schema
            const parentParts = item.parent?.split('_') || [];
            const database = parentParts[2]; // schema_v2_database_schema...
            const schema = parentParts.slice(3).join('_');
            const sequenceName = item.name;

            await SequenceManagementPanel.alterSequence(this.context, this.stateService, schema, sequenceName, database);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            vscode.window.showErrorMessage(`Failed to alter sequence: ${errorMessage}`);
        }
    }

    private dropSequence = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'sequence') {
            return;
        }

        try {
            // Parse parent schema ID to get database and schema
            const parentParts = item.parent?.split('_') || [];
            const database = parentParts[2]; // schema_v2_database_schema...
            const schema = parentParts.slice(3).join('_');
            const sequenceName = item.name;

            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop sequence "${schema}.${sequenceName}"?`,
                { modal: true },
                'Drop (RESTRICT)',
                'Drop (CASCADE)'
            );

            if (!confirmation) {
                return;
            }

            const cascade = confirmation.includes('CASCADE');
            await SequenceManagementPanel.dropSequence(this.context, this.stateService, schema, sequenceName, cascade, database);
            // Note: Tree refresh is handled by SequenceManagementPanel.dropSequence
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            vscode.window.showErrorMessage(`Failed to drop sequence: ${errorMessage}`);
        }
    };

    private async restartSequence(item: SchemaItem): Promise<void> {
        if (item.type !== 'sequence') {
            return;
        }

        try {
            // Parse parent schema ID to get database and schema
            const parentParts = item.parent?.split('_') || [];
            const database = parentParts[2]; // schema_v2_database_schema...
            const schema = parentParts.slice(3).join('_');
            const sequenceName = item.name;

            await SequenceManagementPanel.restartSequence(this.context, this.stateService, schema, sequenceName, database);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            vscode.window.showErrorMessage(`Failed to restart sequence: ${errorMessage}`);
        }
    }

    private async setSequenceValue(item: SchemaItem): Promise<void> {
        if (item.type !== 'sequence') {
            return;
        }

        try {
            // Parse parent schema ID to get database and schema
            const parentParts = item.parent?.split('_') || [];
            const database = parentParts[2]; // schema_v2_database_schema...
            const schema = parentParts.slice(3).join('_');
            const sequenceName = item.name;

            await SequenceManagementPanel.setNextValue(this.context, this.stateService, schema, sequenceName, database);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            vscode.window.showErrorMessage(`Failed to set sequence value: ${errorMessage}`);
        }
    }

    private async createForeignKey(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename
            const { database, schema, name: tableName } = this.parseSchemaItem(item);

            await ForeignKeyManagementPanel.createForeignKey(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create foreign key: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async viewForeignKeyProperties(item: SchemaItem): Promise<void> {
        if (item.type !== 'foreignkey') {
            return;
        }

        try {
            // Parse foreign key ID: foreignkey_database_schema_tablename_fkname
            const { database, schema, name: tableName } = this.parseSchemaItem(item);
            const fkName = parts.slice(4).join('_');

            await ForeignKeyManagementPanel.viewForeignKeyProperties(this.context, this.stateService, schema, tableName, fkName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to view foreign key properties: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private dropForeignKey = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'foreignkey') {
            return;
        }

        try {
            // Parse foreign key ID: foreignkey_database_schema_tablename_fkname
            const { database, schema, name: tableName } = this.parseSchemaItem(item);
            const fkName = parts.slice(4).join('_');

            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop foreign key "${fkName}" from table "${schema}.${tableName}"?`,
                { modal: true },
                'Drop Foreign Key'
            );

            if (!confirmation) {
                return;
            }

            await ForeignKeyManagementPanel.dropForeignKey(this.context, this.stateService, schema, tableName, fkName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop foreign key: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private async createConstraint(item: SchemaItem): Promise<void> {
        if (item.type !== 'table' && item.type !== 'container') {
            return;
        }

        try {
            let database: string;
            let schema: string;
            let tableName: string;

            if (item.type === 'container') {
                // Called from constraints container
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
                tableName = item.metadata?.tableName || '';
            } else {
                // Called from table - parse using parent to handle underscores in schema names
                if (item.parent) {
                    const parentParts = item.parent.split('_');
                    database = parentParts[2];
                    schema = parentParts.slice(3).join('_');
                    const prefix = `table_${database}_${schema}_`;
                    tableName = item.id.substring(prefix.length);
                } else {
                    // Fallback
                    const parts = item.id.split('_');
                    database = parts[1];
                    schema = parts[2];
                    tableName = parts.slice(3).join('_');
                }
            }

            await ConstraintManagementPanel.createConstraint(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create constraint: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private dropConstraint = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'constraint') {
            return;
        }

        try {
            // Get metadata from constraint item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const constraintName = item.name;

            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop constraint "${constraintName}" from table "${schema}.${tableName}"?`,
                { modal: true },
                'Drop Constraint',
                'Drop with CASCADE'
            );

            if (!confirmation) {
                return;
            }

            const cascade = confirmation === 'Drop with CASCADE';
            await ConstraintManagementPanel.dropConstraint(this.context, this.stateService, schema, tableName, constraintName, cascade, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop constraint: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private async editConstraint(item: SchemaItem): Promise<void> {
        if (item.type !== 'constraint') {
            return;
        }

        try {
            // Get metadata from constraint item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const constraintName = item.name;

            await ConstraintManagementPanel.editConstraint(this.context, this.stateService, schema, tableName, constraintName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit constraint: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async createTrigger(item: SchemaItem): Promise<void> {
        if (item.type !== 'table' && item.type !== 'container') {
            return;
        }

        try {
            let database: string;
            let schema: string;
            let tableName: string;

            if (item.type === 'container') {
                // Called from triggers container
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
                tableName = item.metadata?.tableName || '';
            } else {
                // Called from table item
                const parsed = this.parseSchemaItem(item);
                database = parsed.database;
                schema = parsed.schema;
                tableName = parsed.name;
            }

            await TriggerManagementPanel.createTrigger(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create trigger: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async viewTriggerProperties(item: SchemaItem): Promise<void> {
        if (item.type !== 'trigger') {
            return;
        }

        try {
            // Get metadata from trigger item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const triggerName = item.name;

            await TriggerManagementPanel.viewTriggerProperties(this.context, this.stateService, schema, tableName, triggerName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to view trigger properties: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editTrigger(item: SchemaItem): Promise<void> {
        if (item.type !== 'trigger') {
            return;
        }

        try {
            // Get metadata from trigger item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const triggerName = item.name;

            await TriggerManagementPanel.editTrigger(this.context, this.stateService, schema, tableName, triggerName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit trigger: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private enableTrigger = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'trigger') {
            return;
        }

        try {
            // Get metadata from trigger item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const triggerName = item.name;

            await TriggerManagementPanel.toggleTrigger(this.context, this.stateService, schema, tableName, triggerName, true, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to enable trigger: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private disableTrigger = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'trigger') {
            return;
        }

        try {
            // Get metadata from trigger item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const triggerName = item.name;

            await TriggerManagementPanel.toggleTrigger(this.context, this.stateService, schema, tableName, triggerName, false, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to disable trigger: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private dropTrigger = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'trigger') {
            return;
        }

        try {
            // Get metadata from trigger item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const triggerName = item.name;

            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop trigger "${triggerName}" from table "${schema}.${tableName}"?`,
                { modal: true },
                'Drop (RESTRICT)',
                'Drop (CASCADE)'
            );

            if (!confirmation) {
                return;
            }

            const cascade = confirmation.includes('CASCADE');
            await TriggerManagementPanel.dropTrigger(this.context, this.stateService, schema, tableName, triggerName, cascade, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop trigger: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private async createPolicy(item: SchemaItem): Promise<void> {
        if (item.type !== 'table' && item.type !== 'container') {
            return;
        }

        try {
            let database: string;
            let schema: string;
            let tableName: string;

            if (item.type === 'container') {
                // Called from policies container
                database = item.metadata?.database || 'postgres';
                schema = item.metadata?.schema || 'public';
                tableName = item.metadata?.tableName || '';
            } else {
                // Called from table - parse using parent to handle underscores in schema names
                if (item.parent) {
                    const parentParts = item.parent.split('_');
                    database = parentParts[2];
                    schema = parentParts.slice(3).join('_');
                    const prefix = `table_${database}_${schema}_`;
                    tableName = item.id.substring(prefix.length);
                } else {
                    // Fallback
                    const parts = item.id.split('_');
                    database = parts[1];
                    schema = parts[2];
                    tableName = parts.slice(3).join('_');
                }
            }

            await PolicyManagementPanel.createPolicy(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create policy: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editPolicy(item: SchemaItem): Promise<void> {
        if (item.type !== 'policy') {
            return;
        }

        try {
            // Get metadata from policy item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const policyName = item.name;

            await PolicyManagementPanel.editPolicy(this.context, this.stateService, schema, tableName, policyName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit policy: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private dropPolicy = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'policy') {
            return;
        }

        try {
            // Get metadata from policy item
            const database = item.metadata?.database || 'postgres';
            const schema = item.metadata?.schema || 'public';
            const tableName = item.metadata?.tableName || '';
            const policyName = item.name;

            // Confirmation dialog
            const confirmation = await vscode.window.showWarningMessage(
                `Are you sure you want to drop RLS policy "${policyName}" from table "${schema}.${tableName}"?`,
                { modal: true },
                'Drop Policy'
            );

            if (!confirmation) {
                return;
            }

            await PolicyManagementPanel.dropPolicy(this.context, this.stateService, schema, tableName, policyName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop policy: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private async createColumn(item: SchemaItem): Promise<void> {
        // Can be called from table, view, or columnsContainer
        if (item.type !== 'table' && item.type !== 'view' && item.type !== 'container') {
            return;
        }

        try {
            let database: string;
            let schema: string;
            let tableName: string;

            if (item.type === 'container') {
                // Extract from container metadata
                database = item.metadata?.database;
                schema = item.metadata?.schema;
                tableName = item.metadata?.tableName;
            } else {
                // Parse table/view ID - use parent to handle underscores in schema names
                if (item.parent) {
                    const parentParts = item.parent.split('_');
                    database = parentParts[2];
                    schema = parentParts.slice(3).join('_');
                    const prefix = `${item.type}_${database}_${schema}_`;
                    tableName = item.id.substring(prefix.length);
                } else {
                    // Fallback
                    const parts = item.id.split('_');
                    database = parts[1];
                    schema = parts[2];
                    tableName = parts.slice(3).join('_');
                }
            }

            await ColumnManagementPanel.createColumn(this.context, this.stateService, schema, tableName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create column: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async editColumn(item: SchemaItem): Promise<void> {
        if (item.type !== 'column') {
            return;
        }

        try {
            // Use metadata which includes schema, database, and tableName
            const database = item.metadata?.database;
            const schema = item.metadata?.schema;
            const tableName = item.metadata?.tableName;
            const columnName = item.name;
            
            if (!database || !schema || !tableName) {
                throw new Error('Unable to determine database, schema, and table for column');
            }

            await ColumnManagementPanel.editColumn(this.context, this.stateService, schema, tableName, columnName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to edit column: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private dropColumn = async (item: SchemaItem): Promise<void> => {
        if (item.type !== 'column') {
            return;
        }

        try {
            // Use metadata which includes schema, database, and tableName
            const database = item.metadata?.database;
            const schema = item.metadata?.schema;
            const tableName = item.metadata?.tableName;
            const columnName = item.name;
            
            if (!database || !schema || !tableName) {
                throw new Error('Unable to determine database, schema, and table for column');
            }

            await ColumnManagementPanel.dropColumn(this.context, this.stateService, schema, tableName, columnName, database);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to drop column: ${error instanceof Error ? error.message : String(error)}`);
        }
    };

    private async generateModel(item: SchemaItem): Promise<void> {
        if (item.type !== 'table') {
            return;
        }

        try {
            // Parse table ID: table_database_schema_tablename
            const { database, schema, name: tableName } = this.parseSchemaItem(item);

            await ModelGeneratorPanel.generateModelFromTable(
                this.context,
                this.stateService,
                this.schemaService,
                schema,
                tableName,
                database
            );
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to generate model: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async showContextMenu(item: SchemaItem): Promise<void> {
        const actions = this.getActionsForItem(item);
        
        if (actions.length === 0) {
            return;
        }

        const selected = await vscode.window.showQuickPick(actions, {
            placeHolder: `Actions for ${item.name}`,
            title: `${item.type}: ${item.name}`
        });

        if (selected && selected.command) {
            await vscode.commands.executeCommand(selected.command, item);
        }
    }

    private getActionsForItem(item: SchemaItem): Array<{label: string; command: string; description?: string}> {
        const actions: Array<{label: string; command: string; description?: string}> = [];

        switch (item.type) {
            case 'connection':
                actions.push(
                    { label: '$(database) Create Database', command: 'neonLocal.schema.createDatabase' },
                    { label: '$(refresh) Reset branch to parent', command: 'neonLocal.schema.resetFromParent' }
                );
                break;

            case 'database':
                actions.push(
                    { label: '$(terminal) Launch psql', command: 'neonLocal.schema.launchPsql', description: 'Open psql terminal' },
                    { label: '$(trash) Drop Database', command: 'neonLocal.schema.dropDatabase', description: 'Delete this database' }
                );
                break;

            case 'schema':
                actions.push(
                    { label: '$(edit) Edit Schema', command: 'neonLocal.schema.editSchema' },
                    { label: '$(trash) Drop Schema', command: 'neonLocal.schema.dropSchema' }
                );
                break;

            case 'table':
                actions.push(
                    { label: '$(edit) Edit Table', command: 'neonLocal.schema.editTable', description: 'Modify table structure' },
                    { label: '$(export) Import Data', command: 'neonLocal.schema.importData', description: 'Import CSV/JSON' },
                    { label: '$(desktop-download) Export Data', command: 'neonLocal.schema.exportData', description: 'Export to CSV/JSON/SQL' },
                    { label: '$(clear-all) Truncate Table', command: 'neonLocal.schema.truncateTable', description: 'Delete all rows' },
                    { label: '$(trash) Drop Table', command: 'neonLocal.schema.dropTable', description: 'Delete table' }
                );
                break;

            case 'view':
                actions.push(
                    { label: '$(edit) Edit View', command: 'neonLocal.schema.editView', description: 'Modify view definition' }
                );
                // Only show refresh for materialized views
                if (item.metadata?.is_materialized) {
                    actions.push({ label: '$(refresh) Refresh Materialized View', command: 'neonLocal.schema.refreshMaterializedView', description: 'Refresh data' });
                }
                actions.push(
                    { label: '$(trash) Drop View', command: 'neonLocal.schema.dropView', description: 'Delete view' }
                );
                break;

            case 'function':
                actions.push(
                    { label: '$(edit) Edit Function', command: 'neonLocal.schema.editFunction', description: 'Modify function code' },
                    { label: '$(trash) Drop Function', command: 'neonLocal.schema.dropFunction', description: 'Delete function' }
                );
                break;

            case 'sequence':
                actions.push(
                    { label: '$(edit) Edit Sequence', command: 'neonLocal.schema.alterSequence', description: 'Modify sequence settings' },
                    { label: '$(trash) Drop Sequence', command: 'neonLocal.schema.dropSequence', description: 'Delete sequence' }
                );
                break;

            case 'index':
                // Primary key indexes can only be rebuilt, not dropped
                if (item.metadata?.is_primary) {
                    actions.push(
                        { label: '$(sync) Rebuild Index', command: 'neonLocal.schema.reindexIndex', description: 'Rebuild this index' }
                    );
                } else {
                    actions.push(
                        { label: '$(sync) Rebuild Index', command: 'neonLocal.schema.reindexIndex', description: 'Rebuild this index' },
                        { label: '$(trash) Drop Index', command: 'neonLocal.schema.dropIndex', description: 'Delete index' }
                    );
                }
                break;

            case 'foreignkey':
                actions.push(
                    { label: '$(info) View Properties', command: 'neonLocal.schema.viewForeignKeyProperties', description: 'Show constraint details' },
                    { label: '$(search) Open SQL Query', command: 'neonLocal.schema.openSqlQuery' },
                    { label: '$(trash) Drop Foreign Key', command: 'neonLocal.schema.dropForeignKey', description: 'Remove constraint' }
                );
                break;

            case 'constraint':
                actions.push(
                    { label: '$(edit) Edit Constraint', command: 'neonLocal.schema.editConstraint', description: 'Modify constraint definition' },
                    { label: '$(trash) Drop Constraint', command: 'neonLocal.schema.dropConstraint', description: 'Remove constraint' }
                );
                break;

            case 'trigger':
                actions.push(
                    { label: '$(edit) Edit Trigger', command: 'neonLocal.schema.editTrigger', description: 'Modify trigger definition' }
                );
                
                // Show Enable or Disable based on current status
                if (item.metadata?.is_enabled) {
                    actions.push({ label: '$(circle-slash) Disable Trigger', command: 'neonLocal.schema.disableTrigger', description: 'Disable trigger' });
                } else {
                    actions.push({ label: '$(check) Enable Trigger', command: 'neonLocal.schema.enableTrigger', description: 'Enable trigger' });
                }
                
                actions.push(
                    { label: '$(trash) Drop Trigger', command: 'neonLocal.schema.dropTrigger', description: 'Delete trigger' }
                );
                break;

            case 'policy':
                actions.push(
                    { label: '$(edit) Edit Policy', command: 'neonLocal.schema.editPolicy', description: 'Modify RLS policy definition' },
                    { label: '$(trash) Drop Policy', command: 'neonLocal.schema.dropPolicy', description: 'Remove RLS policy' }
                );
                break;

            case 'role':
                // Check if role is a neon_superuser member
                const roleMetadata = item.metadata;
                const memberOf = roleMetadata?.member_of || [];
                const isNeonSuperuser = Array.isArray(memberOf) && memberOf.includes('neon_superuser');
                
                console.log(`Role ${item.name}: memberOf =`, memberOf, 'isNeonSuperuser =', isNeonSuperuser);
                
                // Only show Edit Role and Manage Permissions for non-neon_superuser roles
                if (!isNeonSuperuser) {
                    actions.push(
                        { label: '$(edit) Edit Role', command: 'neonLocal.schema.editRole', description: 'Modify role settings' }
                    );
                }
                
                if (isNeonSuperuser) {
                    actions.push(
                        { label: '$(sync) Reset Password', command: 'neonLocal.schema.resetRolePassword', description: 'Reset password via Neon API' }
                    );
                } else {
                    actions.push(
                        { label: '$(key) Change Password', command: 'neonLocal.schema.changePassword', description: 'Update role password' }
                    );
                }
                
                // Only show Manage Permissions for non-neon_superuser roles
                if (!isNeonSuperuser) {
                    actions.push(
                        { label: '$(shield) Manage Permissions', command: 'neonLocal.schema.manageRolePermissions', description: 'Grant/revoke permissions' }
                    );
                }
                
                // Show different drop option for neon_superuser roles
                if (isNeonSuperuser) {
                    actions.push(
                        { label: '$(trash) Drop Role', command: 'neonLocal.schema.dropRole', description: 'Delete role using Neon API' }
                    );
                } else {
                    actions.push(
                        { label: '$(trash) Drop Role', command: 'neonLocal.schema.dropRole', description: 'Delete role' }
                    );
                }
                break;

            case 'container':
                // Handle container-specific actions
                const containerType = item.metadata?.containerType;
                if (containerType === 'databases') {
                    actions.push(
                        { label: '$(add) Create Database', command: 'neonLocal.schema.createDatabase', description: 'Create a new database' }
                    );
                } else if (containerType === 'schemas') {
                    actions.push(
                        { label: '$(add) Create Schema', command: 'neonLocal.schema.createSchema', description: 'Create a new schema' }
                    );
                } else if (containerType === 'roles') {
                    actions.push(
                        { label: '$(person-add) Create Role', command: 'neonLocal.schema.createUser', description: 'Create a new role' }
                    );
                } else if (containerType === 'tables') {
                    actions.push(
                        { label: '$(add) Create Table', command: 'neonLocal.schema.createTable', description: 'Create a new table' }
                    );
                } else if (containerType === 'views') {
                    actions.push(
                        { label: '$(add) Create View', command: 'neonLocal.schema.createView', description: 'Create a new view' }
                    );
                } else if (containerType === 'functions') {
                    actions.push(
                        { label: '$(add) Create Function', command: 'neonLocal.schema.createFunction', description: 'Create a new function' }
                    );
                } else if (containerType === 'sequences') {
                    actions.push(
                        { label: '$(add) Create Sequence', command: 'neonLocal.schema.createSequence', description: 'Create a new sequence' }
                    );
                } else if (containerType === 'columns') {
                    actions.push(
                        { label: '$(add) Add Column', command: 'neonLocal.schema.createColumn', description: 'Add a new column' }
                    );
                } else if (containerType === 'constraints') {
                    actions.push(
                        { label: '$(add) Create Constraint', command: 'neonLocal.schema.createConstraint', description: 'Create a new constraint' }
                    );
                } else if (containerType === 'policies') {
                    actions.push(
                        { label: '$(add) Create Policy', command: 'neonLocal.schema.createPolicy', description: 'Create a new RLS policy' }
                    );
                }
                break;

            case 'column':
                actions.push(
                    { label: '$(edit) Edit Column', command: 'neonLocal.schema.editColumn', description: 'Modify column definition' },
                    { label: '$(trash) Drop Column', command: 'neonLocal.schema.dropColumn', description: 'Delete column' }
                );
                break;

            default:
                // For other items
                actions.push(
                    { label: '$(search) Open SQL Query', command: 'neonLocal.schema.openSqlQuery', description: 'Open SQL editor' }
                );
                break;
        }

        return actions;
    }

    dispose(): void {
        this.treeView.dispose();
    }
}