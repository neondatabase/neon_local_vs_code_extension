import * as vscode from 'vscode';
import { ViewData, NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole, BranchConnectionInfo } from '../types';
import { ConfigurationManager } from '../utils';

interface ConnectionState {
    connected: boolean;
    isStarting: boolean;
    type: 'existing' | 'new';
    driver: 'serverless' | 'postgres';
    connectionInfo: string;
    currentlyConnectedBranch: string;
    connectedOrgId: string;
    connectedOrgName: string;
    connectedProjectId: string;
    connectedProjectName: string;
    selectedDatabase: string;
    selectedRole: string;
    databases: NeonDatabase[];
    roles: NeonRole[];
    persistentApiToken?: string;
    port: number;
    branchConnectionInfos?: BranchConnectionInfo[];
}

interface SelectionState {
    orgs: NeonOrg[];
    projects: NeonProject[];
    branches: NeonBranch[];
    selectedOrgId: string;
    selectedOrgName: string;
    selectedProjectId?: string;
    selectedProjectName?: string;
    selectedBranchId?: string;
    selectedBranchName?: string;
    parentBranchId?: string;
    parentBranchName?: string;
}

interface LoadingState {
    orgs: boolean;
    projects: boolean;
    branches: boolean;
}

interface State {
    connection: ConnectionState;
    selection: SelectionState;
    loading: LoadingState;
}

export interface IStateService {
    setConnectionType(value: 'existing' | 'new'): Promise<void>;
    getConnectionType(): 'existing' | 'new';
    currentProject: string;
    currentOrg: string;
    currentBranch: string;
    currentlyConnectedBranch: Promise<string>;
    parentBranchId: string;
    port: number;
    setSelectedDatabase(value: string): Promise<void>;
    setSelectedRole(value: string): Promise<void>;
    setPort(value: number): Promise<void>;
    isProxyRunning: boolean;
    isStarting: boolean;
    selectedDriver: 'postgres' | 'serverless';
    selectedDatabase: string;
    selectedRole: string;
    connectionType: 'existing' | 'new';
    persistentApiToken: string | undefined;
    setPersistentApiToken(value: string): Promise<void>;
    setSelectedDriver(value: 'postgres' | 'serverless'): Promise<void>;
    setIsProxyRunning(value: boolean): Promise<void>;
    setIsStarting(value: boolean): Promise<void>;
    setCurrentBranch(value: string): Promise<void>;
    setCurrentOrg(value: string): Promise<void>;
    setCurrentProject(value: string): Promise<void>;
    setParentBranchId(value: string): Promise<void>;
    setCurrentlyConnectedBranch(value: string): Promise<void>;
    setConnectionInfo(value: { connectionInfo: string; selectedDatabase: string }): Promise<void>;
    clearState(): Promise<void>;
    getViewData(): Promise<ViewData>;
    getBranchIdFromFile(): Promise<string>;
    updateDatabase(database: string): Promise<void>;
    updateRole(role: string): Promise<void>;
    setOrganizations(orgs: NeonOrg[]): Promise<void>;
    setProjects(projects: NeonProject[]): Promise<void>;
    setBranches(branches: NeonBranch[]): Promise<void>;
    clearAuth(): Promise<void>;
    getCurrentBranchId(): Promise<string | undefined>;
    getCurrentProjectId(): Promise<string | undefined>;
    getDatabases(): Promise<NeonDatabase[]>;
    setDatabases(databases: NeonDatabase[]): Promise<void>;
    setRoles(roles: NeonRole[]): Promise<void>;
    getRoles(): Promise<NeonRole[]>;
    setBranchConnectionInfos(infos: BranchConnectionInfo[]): Promise<void>;
    getBranchConnectionInfos(): BranchConnectionInfo[];
}

export class StateService implements IStateService {
    private readonly context: vscode.ExtensionContext;
    private state: vscode.Memento;
    private _state: State = {
        connection: {
            connected: false,
            isStarting: false,
            type: 'existing',
            driver: 'postgres',
            connectionInfo: '',
            currentlyConnectedBranch: '',
            connectedOrgId: '',
            connectedOrgName: '',
            connectedProjectId: '',
            connectedProjectName: '',
            selectedDatabase: '',
            selectedRole: '',
            databases: [],
            roles: [],
            persistentApiToken: undefined,
            port: 5432
        },
        selection: {
            orgs: [],
            projects: [],
            branches: [],
            selectedOrgId: '',
            selectedOrgName: '',
            selectedProjectId: undefined,
            selectedProjectName: undefined,
            selectedBranchId: undefined,
            selectedBranchName: undefined,
            parentBranchId: undefined,
            parentBranchName: undefined
        },
        loading: {
            orgs: false,
            projects: false,
            branches: false
        }
    };

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.state = context.globalState;
        this.loadState().catch(error => {
            console.error('Error loading initial state:', error);
        });
    }

    private async loadState() {
        const config = vscode.workspace.getConfiguration('neonLocal');
        const connectionType = await this.state.get<'existing' | 'new'>('neonLocal.connectionType', 'existing');
        const selectedDriver = config.get<string>('driver', 'postgres');
        const connectionInfo = await this.state.get<string>('neonLocal.connectionInfo', '');
        const currentlyConnectedBranch = await this.state.get<string>('neonLocal.currentlyConnectedBranch', '');
        const selectedDatabase = await this.state.get<string>('neonLocal.selectedDatabase', '');
        const selectedRole = await this.state.get<string>('neonLocal.selectedRole', '');
        const selectedOrgId = await this.state.get<string>('neonLocal.selectedOrgId', '');
        const selectedOrgName = await this.state.get<string>('neonLocal.selectedOrgName', '');
        const selectedProjectId = await this.state.get<string>('neonLocal.selectedProjectId', '');
        const selectedProjectName = await this.state.get<string>('neonLocal.selectedProjectName', '');
        const selectedBranchId = await this.state.get<string>('neonLocal.selectedBranchId', '');
        const selectedBranchName = await this.state.get<string>('neonLocal.selectedBranchName', '');
        const parentBranchId = await this.state.get<string>('neonLocal.parentBranchId', '');
        const parentBranchName = await this.state.get<string>('neonLocal.parentBranchName', '');
        const connectedOrgId = await this.state.get<string>('neonLocal.connectedOrgId', '');
        const connectedOrgName = await this.state.get<string>('neonLocal.connectedOrgName', '');
        const connectedProjectId = await this.state.get<string>('neonLocal.connectedProjectId', '');
        const connectedProjectName = await this.state.get<string>('neonLocal.connectedProjectName', '');
        const persistentApiToken = await ConfigurationManager.getSecureToken(this.context, 'persistentApiToken');
        const port = config.get<number>('port', 5432);

        this._state = {
            connection: {
                connected: false,
                isStarting: false,
                type: connectionType,
                driver: selectedDriver as 'postgres' | 'serverless',
                connectionInfo,
                currentlyConnectedBranch,
                connectedOrgId,
                connectedOrgName,
                connectedProjectId,
                connectedProjectName,
                selectedDatabase,
                selectedRole,
                databases: [],
                roles: [],
                persistentApiToken,
                port
            },
            selection: {
                orgs: [],
                projects: [],
                branches: [],
                selectedOrgId,
                selectedOrgName: selectedOrgName || '',
                selectedProjectId: selectedProjectId || undefined,
                selectedProjectName: selectedProjectName || undefined,
                selectedBranchId: selectedBranchId || undefined,
                selectedBranchName: selectedBranchName || undefined,
                parentBranchId: parentBranchId || undefined,
                parentBranchName: parentBranchName || undefined
            },
            loading: {
                orgs: false,
                projects: false,
                branches: false
            }
        };

        await this.saveState();
    }

    private async saveState() {
        await Promise.all([
            this.state.update('neonLocal.connectionType', this._state.connection.type),
            this.state.update('neonLocal.selectedOrgId', this._state.selection.selectedOrgId),
            this.state.update('neonLocal.selectedOrgName', this._state.selection.selectedOrgName),
            this.state.update('neonLocal.selectedProjectId', this._state.selection.selectedProjectId),
            this.state.update('neonLocal.selectedProjectName', this._state.selection.selectedProjectName),
            this.state.update('neonLocal.selectedBranchId', this._state.selection.selectedBranchId),
            this.state.update('neonLocal.selectedBranchName', this._state.selection.selectedBranchName),
            this.state.update('neonLocal.parentBranchId', this._state.selection.parentBranchId),
            this.state.update('neonLocal.parentBranchName', this._state.selection.parentBranchName),
            this.state.update('neonLocal.selectedDriver', this._state.connection.driver),
            this.state.update('neonLocal.selectedDatabase', this._state.connection.selectedDatabase),
            this.state.update('neonLocal.selectedRole', this._state.connection.selectedRole),
            this.state.update('neonLocal.currentlyConnectedBranch', this._state.connection.currentlyConnectedBranch),
            this.state.update('neonLocal.connectionInfo', this._state.connection.connectionInfo),
            this.state.update('neonLocal.connectedOrgId', this._state.connection.connectedOrgId),
            this.state.update('neonLocal.connectedOrgName', this._state.connection.connectedOrgName),
            this.state.update('neonLocal.connectedProjectId', this._state.connection.connectedProjectId),
            this.state.update('neonLocal.connectedProjectName', this._state.connection.connectedProjectName),
            this.state.update('neonLocal.port', this._state.connection.port)
        ]);
    }

    get currentOrg(): string { return this._state.selection.selectedOrgId; }
    get currentProject(): string { return this._state.selection.selectedProjectId || ''; }
    get currentBranch(): string { return this._state.selection.selectedBranchId || ''; }
    get parentBranchId(): string { return this._state.selection.parentBranchId || ''; }
    get isProxyRunning(): boolean { return this._state.connection.connected; }
    get isStarting(): boolean { return this._state.connection.isStarting; }
    get selectedDriver(): 'postgres' | 'serverless' { return this._state.connection.driver; }
    get selectedDatabase(): string { return this._state.connection.selectedDatabase; }
    get selectedRole(): string { return this._state.connection.selectedRole; }
    get connectionType(): 'existing' | 'new' { return this._state.connection.type; }
    get connectionInfo(): string { return this._state.connection.connectionInfo; }
    get currentlyConnectedBranch(): Promise<string> { return Promise.resolve(this._state.connection.currentlyConnectedBranch); }
    get port(): number { return this._state.connection.port; }

    async setConnectionType(value: 'existing' | 'new'): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                type: value
            }
        });
    }

    async setSelectedDriver(value: 'postgres' | 'serverless'): Promise<void> {
        const config = vscode.workspace.getConfiguration('neonLocal');
        await config.update('driver', value, vscode.ConfigurationTarget.Global);
        await this.updateState({
            connection: {
                ...this._state.connection,
                driver: value
            }
        });
    }

    async setSelectedDatabase(database: string): Promise<void> {
        const baseConnectionString = `postgres://neon:npg@localhost:${this._state.connection.port}<database_name>`;
        const newConnectionString = database 
            ? `${baseConnectionString}/${database}`
            : baseConnectionString;

        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedDatabase: database,
                connectionInfo: newConnectionString
            }
        });
    }

    async setSelectedRole(value: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedRole: value
            }
        });
    }

    async setConnectionInfo(value: { connectionInfo: string; selectedDatabase: string }): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                connectionInfo: value.connectionInfo,
                selectedDatabase: value.selectedDatabase
            }
        });
    }

    async setIsProxyRunning(value: boolean): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                connected: value,
                isStarting: false
            }
        });
    }

    async setIsStarting(value: boolean): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                isStarting: value
            }
        });
    }

    async setCurrentBranch(value: string): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                selectedBranchId: value
            }
        });
    }

    async setCurrentOrg(value: string): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                selectedOrgId: value,
                selectedOrgName: this._state.selection.orgs.find(org => org.id === value)?.name || ''
            }
        });
    }

    async setCurrentProject(value: string): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                selectedProjectId: value,
                selectedProjectName: this._state.selection.projects.find(project => project.id === value)?.name || ''
            }
        });
    }

    async setParentBranchId(value: string): Promise<void> {
        const branch = this._state.selection.branches.find(b => b.id === value);
        await this.updateState({
            selection: {
                ...this._state.selection,
                parentBranchId: value,
                parentBranchName: branch?.name
            }
        });
    }

    async setCurrentlyConnectedBranch(value: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                currentlyConnectedBranch: value
            }
        });
    }

    async clearState(): Promise<void> {
        this._state = {
            connection: {
                connected: false,
                isStarting: false,
                type: 'existing',
                driver: 'postgres',
                connectionInfo: '',
                currentlyConnectedBranch: '',
                selectedDatabase: '',
                selectedRole: '',
                databases: [],
                roles: [],
                connectedOrgId: '',
                connectedOrgName: '',
                connectedProjectId: '',
                connectedProjectName: '',
                persistentApiToken: undefined,
                port: 5432
            },
            selection: {
                orgs: [],
                projects: [],
                branches: [],
                selectedOrgId: '',
                selectedOrgName: '',
                selectedProjectId: undefined,
                selectedProjectName: undefined,
                selectedBranchId: undefined,
                selectedBranchName: undefined,
                parentBranchId: undefined,
                parentBranchName: undefined
            },
            loading: {
                orgs: false,
                projects: false,
                branches: false
            }
        };
        await this.saveState();
    }

    public async getViewData(): Promise<ViewData> {
        return {
            connection: {
                connected: this._state.connection.connected,
                isStarting: this._state.connection.isStarting,
                type: this._state.connection.type,
                driver: this._state.connection.driver,
                connectionInfo: this._state.connection.connectionInfo,
                currentlyConnectedBranch: this._state.connection.currentlyConnectedBranch,
                selectedDatabase: this._state.connection.selectedDatabase,
                selectedRole: this._state.connection.selectedRole,
                databases: this._state.connection.databases,
                roles: this._state.connection.roles,
                selectedOrgId: this._state.selection.selectedOrgId || '',
                selectedOrgName: this._state.selection.selectedOrgName || '',
                selectedProjectId: this._state.selection.selectedProjectId,
                selectedProjectName: this._state.selection.selectedProjectName,
                selectedBranchId: this._state.selection.selectedBranchId,
                selectedBranchName: this._state.selection.selectedBranchName,
                parentBranchId: this._state.selection.parentBranchId,
                parentBranchName: this._state.selection.parentBranchName,
                persistentApiToken: this._state.connection.persistentApiToken,
                port: this._state.connection.port,
                branchConnectionInfos: this._state.connection.branchConnectionInfos
            },
            connected: this._state.connection.connected,
            isStarting: this._state.connection.isStarting,
            connectionType: this._state.connection.type,
            selectedDriver: this._state.connection.driver,
            connectionInfo: this._state.connection.connectionInfo,
            selectedDatabase: this._state.connection.selectedDatabase,
            selectedRole: this._state.connection.selectedRole,
            currentlyConnectedBranch: this._state.connection.currentlyConnectedBranch,
            databases: this._state.connection.databases,
            roles: this._state.connection.roles,
            orgs: this._state.selection.orgs,
            projects: this._state.selection.projects,
            branches: this._state.selection.branches,
            selectedOrgId: this._state.selection.selectedOrgId,
            selectedOrgName: this._state.selection.selectedOrgName,
            selectedProjectId: this._state.selection.selectedProjectId,
            selectedProjectName: this._state.selection.selectedProjectName,
            selectedBranchId: this._state.selection.selectedBranchId,
            selectedBranchName: this._state.selection.selectedBranchName,
            parentBranchId: this._state.selection.parentBranchId,
            parentBranchName: this._state.selection.parentBranchName,
            port: this._state.connection.port,
            loading: this._state.loading
        };
    }

    public async getBranchIdFromFile(): Promise<string> {
        return this._state.selection.selectedBranchId || '';
    }

    async updateDatabase(database: string): Promise<void> {
        const baseConnectionString = `postgres://neon:npg@localhost:${this._state.connection.port}<database_name>`;
        const newConnectionString = database 
            ? `${baseConnectionString}/${database}`
            : baseConnectionString;

        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedDatabase: database,
                connectionInfo: newConnectionString
            }
        });
    }

    async updateRole(role: string): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                selectedRole: role
            }
        });
    }

    async setDatabases(databases: NeonDatabase[]): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                databases
            }
        });
    }

    async setRoles(roles: NeonRole[]): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                roles
            }
        });
    }

    public async updateState(newState: Partial<State>): Promise<void> {
        console.debug('Updating state:', {
            current: this._state,
            updates: newState
        });
        this._state = {
            ...this._state,
            connection: newState.connection ? {
                ...this._state.connection,
                ...newState.connection
            } : this._state.connection,
            selection: newState.selection ? {
                ...this._state.selection,
                ...newState.selection
            } : this._state.selection,
            loading: newState.loading ? {
                ...this._state.loading,
                ...newState.loading
            } : this._state.loading
        };
        await this.saveState();
        await this.updateViewData();
        console.debug('State updated:', this._state);
    }

    getConnectionType(): 'existing' | 'new' {
        return this._state.connection.type;
    }

    public async setOrganizations(orgs: NeonOrg[]): Promise<void> {
        this._state.selection.orgs = orgs;
        await this.saveState();
    }

    public async setProjects(projects: NeonProject[]): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                projects
            }
        });
    }

    public async setBranches(branches: NeonBranch[]): Promise<void> {
        await this.updateState({
            selection: {
                ...this._state.selection,
                branches
            }
        });
    }

    public async updateLoadingState(loading: { orgs?: boolean; projects?: boolean; branches?: boolean }): Promise<void> {
        await this.updateState({
            loading: {
                ...this._state.loading,
                ...loading
            }
        });
    }

    public async clearAuth(): Promise<void> {
        await ConfigurationManager.clearAuth(this.context);
        const config = vscode.workspace.getConfiguration('neonLocal');
        await config.update('projectId', undefined, true);
        await this.setIsProxyRunning(false);
        await this.clearState();
    }

    public async getCurrentBranchId(): Promise<string | undefined> {
        return this._state.selection.selectedBranchId;
    }

    public async getCurrentProjectId(): Promise<string | undefined> {
        return this._state.selection.selectedProjectId;
    }

    public async getDatabases(): Promise<NeonDatabase[]> {
        return this._state.connection.databases;
    }

    public async getRoles(): Promise<NeonRole[]> {
        return this._state.connection.roles;
    }

    private async updateViewData(): Promise<void> {
        // Notify any listeners that the view data has changed
        const viewData = await this.getViewData();
        await vscode.commands.executeCommand('neonLocal.viewDataChanged', viewData);
    }

    public get persistentApiToken(): string | undefined {
        return this._state.connection.persistentApiToken;
    }

    public async setPersistentApiToken(value: string): Promise<void> {
        this._state.connection.persistentApiToken = value;
        await ConfigurationManager.updateSecureToken(this.context, 'persistentApiToken', value);
        await this.updateViewData();
    }

    async setPort(value: number): Promise<void> {
        const config = vscode.workspace.getConfiguration('neonLocal');
        await config.update('port', value, vscode.ConfigurationTarget.Global);
        await this.updateState({
            connection: {
                ...this._state.connection,
                port: value
            }
        });
    }

    public async setBranchConnectionInfos(infos: BranchConnectionInfo[]): Promise<void> {
        await this.updateState({
            connection: {
                ...this._state.connection,
                branchConnectionInfos: infos
            }
        });
    }

    public getBranchConnectionInfos(): BranchConnectionInfo[] {
        return this._state.connection.branchConnectionInfos || [];
    }
} 