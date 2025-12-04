import * as vscode from 'vscode';
import { IStateService } from './services/state.service';

export interface NeonBranch {
    id: string;
    name: string;
    project_id: string;
    parent_id: string | null;
}

export interface NeonProject {
    id: string;
    name: string;
    org_id: string;
}

export interface NeonOrg {
    id: string;
    name: string;
}

export interface NeonDatabase {
    name: string;
    owner_name: string;
    created_at: string;
    size_bytes?: number;
}

export interface NeonRole {
    name: string;
    protected: boolean;
    created_at: string;
    updated_at: string;
}

export interface BranchConnectionInfo {
    host: string;
    database: string;
    user: string;
    password: string;
}

export interface ViewData {
    connection: {
        connected: boolean;
        isStarting: boolean;
        type: 'existing' | 'new';
        driver: 'serverless' | 'postgres';
        connectionInfo: string;
        currentlyConnectedBranch: string;
        selectedDatabase: string;
        selectedRole: string;
        databases: NeonDatabase[];
        roles: NeonRole[];
        selectedOrgId: string;
        selectedOrgName: string;
        selectedProjectId?: string;
        selectedProjectName?: string;
        selectedBranchId?: string;
        selectedBranchName?: string;
        parentBranchId?: string;
        parentBranchName?: string;
        persistentApiToken?: string;
        port: number;
        branchConnectionInfos?: BranchConnectionInfo[];
    };
    connected: boolean;
    isStarting: boolean;
    connectionType: 'existing' | 'new';
    selectedDriver: 'postgres' | 'serverless';
    connectionInfo: string;
    selectedDatabase: string;
    selectedRole: string;
    currentlyConnectedBranch: string;
    databases: NeonDatabase[];
    roles: NeonRole[];
    orgs: NeonOrg[];
    projects: NeonProject[];
    branches: NeonBranch[];
    selectedOrgId?: string;
    selectedOrgName?: string;
    selectedProjectId?: string;
    selectedProjectName?: string;
    selectedBranchId?: string;
    selectedBranchName?: string;
    parentBranchId?: string;
    parentBranchName?: string;
    port: number;
    isExplicitUpdate?: boolean;
    loading: {
        orgs: boolean;
        projects: boolean;
        branches: boolean;
    };
}

export interface Database {
    name: string;
}

export interface Role {
    name: string;
}

export interface WebviewMessage {
    command: string;
    [key: string]: any;
}

export type WebviewCommand = 
    | 'signIn'
    | 'selectOrg'
    | 'selectProject'
    | 'selectBranch'
    | 'selectDatabase'
    | 'selectRole'
    | 'startProxy'
    | 'stopProxy'
    | 'updateConnectionType'
    | 'updatePort'
    | 'showLoading'
    | 'signInSuccess'
    | 'resetSignIn'
    | 'refresh'
    | 'resetFromParent'
    | 'openSqlEditor'
    | 'launchPsql'
    | 'requestInitialData'
    | 'openTableView';

export interface NeonLocalManager {
    handleOrgSelection(orgId: string): Promise<void>;
    handleProjectSelection(projectId: string): Promise<void>;
    handleBranchSelection(branchId: string, restartProxy: boolean, driver: string): Promise<void>;
    handleParentBranchSelection(parentBranchId: string): Promise<void>;
    handleDatabaseSelection(database: string): Promise<void>;
    handleRoleSelection(role: string): Promise<void>;
    handleStopProxy(): Promise<void>;
    setWebviewView(view: vscode.WebviewView): void;
    getViewData(): Promise<ViewData>;
}

export interface NeonConfiguration {
    apiKey?: string;
    refreshToken?: string;
    projectId?: string;
    driver?: 'postgres' | 'serverless';
    deleteOnStop?: boolean;
    connectionType?: 'existing' | 'new';
    persistentApiToken?: string;
}

export interface DockerConfig {
    image: string;
    containerName: string;
    ports: { [key: string]: string };
    environment: { [key: string]: string };
    volumes?: { [key: string]: string };
    deleteOnStop?: boolean;
    connectionType?: 'existing' | 'new';
} 