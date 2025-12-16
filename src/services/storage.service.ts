import * as vscode from 'vscode';

export class StorageService {
    private state: vscode.Memento;

    constructor(context: vscode.ExtensionContext) {
        this.state = context.globalState;
    }

    async get<T>(key: string, defaultValue: T): Promise<T> {
        return this.state.get<T>(key, defaultValue);
    }

    async update<T>(key: string, value: T): Promise<void> {
        await this.state.update(key, value);
    }

    async loadInitialState() {
        return {
            connection: {
                type: await this.get('neonLocal.connectionType', 'existing' as const),
                driver: await this.get('neonLocal.selectedDriver', 'postgres' as const),
                connected: false,
                isStarting: false,
                connectionInfo: await this.get('neonLocal.connectionInfo', ''),
                displayConnectionInfo: '',
                currentlyConnectedBranch: await this.get('neonLocal.currentlyConnectedBranch', ''),
                selectedDatabase: await this.get('neonLocal.selectedDatabase', ''),
                selectedRole: await this.get('neonLocal.selectedRole', ''),
                persistentApiToken: await this.get('neonLocal.persistentApiToken', undefined),
                connectedOrgId: '',
                connectedOrgName: '',
                connectedProjectId: '',
                connectedProjectName: ''
            },
            selection: {
                orgs: [],
                projects: [],
                branches: [],
                selectedOrgId: await this.get('neonLocal.currentOrg', ''),
                selectedOrgName: '',
                selectedProjectId: await this.get('neonLocal.currentProject', ''),
                selectedProjectName: '',
                selectedBranchId: await this.get('neonLocal.currentBranch', ''),
                selectedBranchName: '',
                parentBranchId: await this.get('neonLocal.parentBranchId', ''),
                parentBranchName: '',
                selectedConnectionType: await this.get('neonLocal.selectedConnectionType', 'existing'),
                selectedDriver: await this.get('neonLocal.selectedDriver', 'postgres')
            }
        };
    }
} 