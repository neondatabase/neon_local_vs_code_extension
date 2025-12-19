import * as vscode from 'vscode';
import { ConfigurationManager, Logger } from '../utils';
import { DEBOUNCE_DELAY, VIEW_TYPES } from '../constants';
import { ViewData, WebviewMessage, NeonOrg, NeonProject, NeonBranch } from '../types';
import * as path from 'path';
import * as fs from 'fs';
import { WebViewService } from '../services/webview.service';
import { StateService } from '../services/state.service';
import { NeonApiService } from '../services/api.service';
import { SignInView } from './SignInView';
import { AuthManager } from '../auth/authManager';

export class ConnectViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = VIEW_TYPES.CONNECT;
    private _view?: vscode.WebviewView;
    private _updateViewTimeout?: NodeJS.Timeout;
    private _isUpdating = false;
    private _lastRequestedConnectionType?: 'existing' | 'new';
    private _connectionTypeUpdateTimeout?: NodeJS.Timeout;
    private readonly _extensionUri: vscode.Uri;
    private readonly _webviewService: WebViewService;
    private readonly _stateService: StateService;
    private readonly _extensionContext: vscode.ExtensionContext;
    private _lastUpdateData?: ViewData;
    private _signInView?: SignInView;
    private readonly _authManager: AuthManager;
    private _lastKnownToken?: string;
    private _authStateChangeDisposable?: vscode.Disposable;
    private _endpointInfoCache: Map<string, {
        projectId?: string;
        branchId?: string;
        projectName?: string;
        branchName?: string;
        orgName?: string;
        orgId?: string;
        error?: string;
        timestamp: number;
    }> = new Map();
    private _detectedConnectionsCache?: {
        connections: Array<{
            file: string;
            connectionString: string;
            database?: string;
            projectId?: string;
            branchId?: string;
            endpointId?: string;
            projectName?: string;
            branchName?: string;
            orgName?: string;
            orgId?: string;
            error?: string;
        }>;
        timestamp: number;
    };

    constructor(
        extensionUri: vscode.Uri,
        webviewService: WebViewService,
        stateService: StateService,
        extensionContext: vscode.ExtensionContext
    ) {
        this._extensionUri = extensionUri;
        this._webviewService = webviewService;
        this._stateService = stateService;
        this._extensionContext = extensionContext;
        this._authManager = AuthManager.getInstance(extensionContext);

        // Listen for authentication state changes
        this._authStateChangeDisposable = this._authManager.onDidChangeAuthentication(async (isAuthenticated) => {
            if (isAuthenticated) {
                // User has signed in or imported a token, initialize the view
                await this.initializeViewData();
                if (this._view) {
                    this._view.webview.html = this.getWebviewContent(this._view.webview);
                }
            } else {
                // User has signed out, clear state and show sign-in
                await this._stateService.clearState();
                if (this._view && this._signInView) {
                    this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your Neon branch", true);
                }
            }
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            enableCommandUris: false,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this.getWebviewContent(webviewView.webview);

        // Set up message handler
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            await this.handleWebviewMessage(message);
        });

        // Create sign-in view
        this._signInView = new SignInView(webviewView.webview, this._stateService, this._authManager);

        // Register this view with the manager
        const viewId = this._webviewService.registerWebview(webviewView.webview, 'connectView');
        console.debug(`ConnectViewProvider: Registered webview with ID: ${viewId}`);

        // Initial update with a small delay to ensure proper registration
        setTimeout(async () => {
            try {
                // Ensure AuthManager has completed initialization (incl. silent refresh)
                await this._authManager.ready();
                const isAuthenticated = await this._authManager.isAuthenticatedAsync();
                console.debug('ConnectViewProvider: Authentication state check', { isAuthenticated });

                if (!isAuthenticated) {
                    console.debug('ConnectViewProvider: Not authenticated, showing sign-in');
                    if (this._view && this._signInView) {
                        this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your Neon branch", true);
                    }
                    return;
                }

                // User is authenticated (either via OAuth or persistent API key), show connect view and initialize
                console.debug('ConnectViewProvider: User is authenticated, showing connect view');
                if (this._view) {
                    this._view.webview.html = this.getWebviewContent(this._view.webview);
                }
                await this.initializeViewData();
            } catch (error) {
                console.error('Error in initial view update:', error);
                if (error instanceof Error) {
                    vscode.window.showErrorMessage(`View initialization error: ${error.message}`);
                }
            }
        }, 100);
    }

    private async initializeViewData(): Promise<void> {
        const apiService = new NeonApiService(this._extensionContext);

        // Start loading organizations
        await this._stateService.updateLoadingState({
            orgs: true,
            projects: true,
            branches: true
        });

        try {
            // Fetch organizations first
            console.debug('initializeViewData: About to call getOrgs()');
            const orgs = await apiService.getOrgs();
            console.debug('initializeViewData: getOrgs() returned', { orgCount: orgs.length });
            
            // Check if organizations have changed (indicating different user)
            const currentViewData = await this._stateService.getViewData();
            const currentOrgs = currentViewData.orgs;
            
            // Compare organization IDs to detect if user has changed
            const currentOrgIds = currentOrgs.map(org => org.id).sort();
            const newOrgIds = orgs.map(org => org.id).sort();
            
            const orgsChanged = currentOrgs.length > 0 && 
                               (currentOrgIds.length !== newOrgIds.length || 
                                !currentOrgIds.every((id, index) => id === newOrgIds[index]));
            
            if (orgsChanged) {
                console.debug('Different organizations detected after sign-in, clearing state');
                await this._stateService.clearState();
            }
            
            await this._stateService.setOrganizations(orgs);
            await this._stateService.updateLoadingState({
                orgs: false
            });

            // Only fetch projects if there's a valid organization selected
            const currentOrgId = this._stateService.currentOrg;
            if (currentOrgId && currentOrgId !== '') {
                try {
                    const projects = await apiService.getProjects(currentOrgId);
                    await this._stateService.setProjects(projects);
                    await this._stateService.updateLoadingState({
                        projects: false
                    });

                    // If there's a pre-selected project, fetch its branches
                    const currentProjectId = this._stateService.currentProject;
                    if (currentProjectId) {
                        try {
                            const branches = await apiService.getBranches(currentProjectId);
                            await this._stateService.setBranches(branches);
                        } catch (error) {
                            console.error('Error fetching branches for pre-selected project:', error);
                            if (error instanceof Error) {
                                vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error fetching projects for pre-selected organization:', error);
                    if (error instanceof Error) {
                        vscode.window.showErrorMessage(`Failed to fetch projects: ${error.message}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching organizations:', error);
            if (error instanceof Error) {
                const errorMessage = error.message;
                vscode.window.showErrorMessage(`Failed to fetch organizations: ${errorMessage}`);
                
                // If timeout, suggest checking network
                if (errorMessage.includes('timeout')) {
                    vscode.window.showWarningMessage(
                        'The request to Neon API timed out. Please check your network connection or try again later.'
                    );
                }
            }
        }

        // Clear loading states
        await this._stateService.updateLoadingState({
            orgs: false,
            projects: false,
            branches: false
        });
        
        // Update view
        await this.updateView();
    }

    private debouncedUpdateView = () => {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        this._updateViewTimeout = setTimeout(() => {
            this.updateView();
        }, DEBOUNCE_DELAY);
    };

    private async handleWebviewMessage(message: WebviewMessage): Promise<void> {
        if (!this._view) return;

        try {
            switch (message.command) {
                case 'signIn':
                    if (this._signInView) {
                        await this._signInView.handleSignIn();
                        // The authentication state change listener will handle the UI update
                        // After sign-in completes, also update stateService with the persistent token
                        const persistentToken = await this._authManager.getPersistentApiToken();
                        if (persistentToken) {
                            console.debug('ConnectViewProvider: Updating stateService with persistent API token');
                            await this._stateService.setPersistentApiToken(persistentToken);
                        }
                        // Explicitly refresh the view after sign-in completes
                        if (this._authManager.isAuthenticated && this._view) {
                            console.debug('ConnectViewProvider: Explicitly refreshing view after sign-in');
                            await this.initializeViewData();
                            this._view.webview.html = this.getWebviewContent(this._view.webview);
                        }
                    }
                    break;
                case 'showLoading':
                case 'resetSignIn':
                case 'showError':
                    this._signInView?.handleMessage(message);
                    break;
                case 'importToken':
                    const token = await vscode.window.showInputBox({
                        prompt: 'Enter your Neon persistent API token',
                        password: true,
                        ignoreFocusOut: true
                    });

                    if (token) {
                        // Validate the token by making an API call
                        console.debug('🔍 Validating imported API token...');
                        
                        try {
                            // Show progress while validating
                            await vscode.window.withProgress({
                                location: vscode.ProgressLocation.Notification,
                                title: "Validating API token...",
                                cancellable: false
                            }, async (progress) => {
                                // Create API service and test the token directly (no storage needed)
                                const testApiService = new NeonApiService(this._extensionContext);
                                
                                console.debug('📡 Testing API token with validation call...');
                                const isValid = await testApiService.validateToken(token);
                                
                                if (!isValid) {
                                    throw new Error('Invalid API token');
                                }
                                
                                console.debug('✅ API token validation successful');
                                
                                // Token is valid, proceed with storing it permanently
                                await this._authManager.setPersistentApiToken(token);
                                await this._stateService.setPersistentApiToken(token);
                                
                                console.debug('✅ API token imported and stored successfully');
                            });
                            
                            // The authentication state change listener will handle the UI update
                            
                        } catch (error) {
                            console.error('❌ API token validation failed:', error);
                            
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                            vscode.window.showErrorMessage(
                                `Invalid API token: ${errorMessage}. Please check your token and try again.`
                            );
                            
                            // Don't store the invalid token
                            console.debug('❌ API token not imported due to validation failure');
                        }
                    }
                    break;
                case 'clearAuth':
                    // Show sign-in view without clearing state
                    if (this._view && this._signInView) {
                        this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your Neon branch", true);
                    }
                    break;
                case 'openNeonConsole':
                    await vscode.env.openExternal(vscode.Uri.parse(`https://console.neon.tech${message.path}`));
                    break;
                case 'selectOrg':
                    // Get current state data
                    const viewData = await this._stateService.getViewData();
                    const selectedOrg = viewData.orgs.find((org: NeonOrg) => org.id === message.orgId);
                    if (!selectedOrg) {
                        console.error('Selected org not found:', message.orgId);
                        vscode.window.showErrorMessage('Selected organization not found');
                        return;
                    }
                    
                    // Clear all downstream selections
                    await this._stateService.updateState({
                        selection: {
                            orgs: viewData.orgs,
                            projects: [],
                            branches: [],
                            selectedOrgId: message.orgId,
                            selectedOrgName: selectedOrg.name,
                            selectedProjectId: undefined,
                            selectedProjectName: undefined,
                            selectedBranchId: undefined,
                            selectedBranchName: undefined,
                            parentBranchId: undefined,
                            parentBranchName: undefined
                        }
                    });
                    
                    // Fetch projects for the selected organization
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        const projects = await apiService.getProjects(message.orgId);
                        await this._stateService.setProjects(projects);
                    } catch (error) {
                        console.error('Error fetching projects:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch projects: ${error.message}`);
                        }
                    }
                    
                    // Force UI refresh to clear dropdowns
                    await this.updateView();
                    break;
                case 'selectProject':
                    // Get current state data
                    let currentState = await this._stateService.getViewData();
                    let selectedProject = currentState.projects.find((project: NeonProject) => project.id === message.projectId);
                    
                    // If project not found in current state, try to fetch projects for the selected org
                    if (!selectedProject && currentState.selectedOrgId) {
                        console.debug(`Project ${message.projectId} not found in state, fetching projects for org ${currentState.selectedOrgId}`);
                        try {
                            const apiService = new NeonApiService(this._extensionContext);
                            const projects = await apiService.getProjects(currentState.selectedOrgId);
                            
                            // Update state with newly fetched projects
                            await this._stateService.updateState({
                                selection: {
                                    ...currentState,
                                    projects: projects
                                }
                            });
                            
                            // Refresh state and try to find the project again
                            currentState = await this._stateService.getViewData();
                            selectedProject = currentState.projects.find((project: NeonProject) => project.id === message.projectId);
                        } catch (error) {
                            console.error('Failed to fetch projects:', error);
                        }
                    }
                    
                    if (!selectedProject) {
                        console.error('Selected project not found:', message.projectId);
                        vscode.window.showErrorMessage('Selected project not found');
                        return;
                    }
                    // Clear branch selections and update project selection
                    await this._stateService.updateState({
                        selection: {
                            orgs: currentState.orgs,
                            projects: currentState.projects,
                            branches: [],
                            selectedOrgId: currentState.selectedOrgId || '',
                            selectedOrgName: currentState.selectedOrgName || '',
                            selectedProjectId: message.projectId,
                            selectedProjectName: selectedProject.name,
                            selectedBranchId: undefined,
                            selectedBranchName: undefined,
                            parentBranchId: undefined,
                            parentBranchName: undefined
                        }
                    });
                    
                    // Also clear the current branch to ensure container gets the right branch ID later
                    await this._stateService.setCurrentBranch('');
                    await this._stateService.setParentBranchId('');
                    
                    // Fetch branches for the selected project
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        const branches = await apiService.getBranches(message.projectId);
                        await this._stateService.setBranches(branches);
                        
                        // After loading branches, check if there's a previously selected branch for this project
                        // that should be restored and properly synchronized
                        const updatedState = await this._stateService.getViewData();
                        if (updatedState.selectedBranchId && updatedState.connectionType === 'existing') {
                            // Verify the branch still exists in the project
                            const branchExists = branches.find(branch => branch.id === updatedState.selectedBranchId);
                            if (branchExists) {
                                console.debug('Restoring previously selected branch for project:', updatedState.selectedBranchId);
                                // Update the state to ensure branch name is correct AND sync the backend current branch
                                await this._stateService.setCurrentBranch(updatedState.selectedBranchId);
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        selectedBranchName: branchExists.name
                                    }
                                });
                            } else {
                                // Branch no longer exists, clear the selection
                                console.debug('Previously selected branch no longer exists, clearing selection');
                                await this._stateService.setCurrentBranch('');
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        selectedBranchId: undefined,
                                        selectedBranchName: undefined
                                    }
                                });
                            }
                        } else if (updatedState.parentBranchId && updatedState.connectionType === 'new') {
                            // Handle parent branch restoration for new connection type
                            const branchExists = branches.find(branch => branch.id === updatedState.parentBranchId);
                            if (branchExists) {
                                console.debug('Restoring previously selected parent branch for project:', updatedState.parentBranchId);
                                // Sync the backend parent branch state
                                await this._stateService.setParentBranchId(updatedState.parentBranchId);
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        parentBranchName: branchExists.name
                                    }
                                });
                            } else {
                                console.debug('Previously selected parent branch no longer exists, clearing selection');
                                await this._stateService.setParentBranchId('');
                                await this._stateService.updateState({
                                    selection: {
                                        ...updatedState,
                                        parentBranchId: undefined,
                                        parentBranchName: undefined
                                    }
                                });
                            }
                        }
                    } catch (error) {
                        console.error('Error fetching branches:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to fetch branches: ${error.message}`);
                        }
                    }
                    await this.updateView();
                    break;
                case 'selectBranch':
                    let branchState = await this._stateService.getViewData();
                    let selectedBranch = branchState.branches.find((branch: NeonBranch) => branch.id === message.branchId);
                    let didFetchBranches = false;
                    
                    // If branch not found in current state, try to fetch branches for the selected project
                    if (!selectedBranch && branchState.selectedProjectId) {
                        console.debug(`Branch ${message.branchId} not found in state, fetching branches for project ${branchState.selectedProjectId}`);
                        try {
                            const apiService = new NeonApiService(this._extensionContext);
                            const branches = await apiService.getBranches(branchState.selectedProjectId);
                            await this._stateService.setBranches(branches);
                            didFetchBranches = true;
                            
                            // Refresh state and try to find the branch again
                            branchState = await this._stateService.getViewData();
                            selectedBranch = branchState.branches.find((branch: NeonBranch) => branch.id === message.branchId);
                            
                            if (selectedBranch) {
                                console.debug(`✅ Branch ${message.branchId} found after fetching`);
                            }
                        } catch (error) {
                            console.error('Failed to fetch branches:', error);
                        }
                    }
                    
                    if (!selectedBranch) {
                        // Only show error message if we actually tried to fetch but still couldn't find it
                        if (didFetchBranches) {
                            console.error('Selected branch not found even after fetching:', message.branchId);
                            vscode.window.showErrorMessage('Selected branch not found');
                        } else if (branchState.selectedProjectId) {
                            // Project is selected but branch not found and we didn't fetch (shouldn't happen)
                            console.error('Selected branch not found:', message.branchId);
                            vscode.window.showErrorMessage('Selected branch not found');
                        } else {
                            // No project selected yet - this is expected during initialization, don't show error
                            console.debug('Branch selection ignored - no project selected yet:', message.branchId);
                        }
                        return;
                    }

                    // Handle both regular branch and parent branch selection based on connection type
                    if (branchState.connectionType === 'existing') {
                        await this._stateService.setCurrentBranch(message.branchId);
                        await this._stateService.updateState({
                            selection: {
                                orgs: branchState.orgs,
                                projects: branchState.projects,
                                branches: branchState.branches,
                                selectedOrgId: branchState.selectedOrgId || '',
                                selectedOrgName: branchState.selectedOrgName || '',
                                selectedProjectId: branchState.selectedProjectId,
                                selectedProjectName: branchState.selectedProjectName,
                                selectedBranchId: message.branchId,
                                selectedBranchName: selectedBranch.name,
                                parentBranchId: branchState.parentBranchId,
                                parentBranchName: branchState.parentBranchName
                            }
                        });
                    } else {
                        await this._stateService.setParentBranchId(message.branchId);
                        await this._stateService.updateState({
                            selection: {
                                orgs: branchState.orgs,
                                projects: branchState.projects,
                                branches: branchState.branches,
                                selectedOrgId: branchState.selectedOrgId || '',
                                selectedOrgName: branchState.selectedOrgName || '',
                                selectedProjectId: branchState.selectedProjectId,
                                selectedProjectName: branchState.selectedProjectName,
                                selectedBranchId: branchState.selectedBranchId,
                                selectedBranchName: branchState.selectedBranchName,
                                parentBranchId: message.branchId,
                                parentBranchName: selectedBranch.name
                            }
                        });
                    }
                    await this.updateView();
                    break;

                case 'refreshOrgs':
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        const orgs = await apiService.getOrgs();
                        const refreshState = await this._stateService.getViewData();
                        
                        await this._stateService.updateState({
                            selection: {
                                orgs: orgs,
                                projects: refreshState.projects,
                                branches: refreshState.branches,
                                selectedOrgId: refreshState.selectedOrgId || '',
                                selectedOrgName: refreshState.selectedOrgName || '',
                                selectedProjectId: refreshState.selectedProjectId,
                                selectedProjectName: refreshState.selectedProjectName,
                                selectedBranchId: refreshState.selectedBranchId,
                                selectedBranchName: refreshState.selectedBranchName,
                                parentBranchId: refreshState.parentBranchId,
                                parentBranchName: refreshState.parentBranchName
                            }
                        });
                        await this.updateView();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to refresh organizations: ${error}`);
                    }
                    break;

                case 'refreshProjects':
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        const projects = await apiService.getProjects(message.orgId);
                        const refreshState = await this._stateService.getViewData();
                        
                        await this._stateService.updateState({
                            selection: {
                                orgs: refreshState.orgs,
                                projects: projects,
                                branches: refreshState.branches,
                                selectedOrgId: refreshState.selectedOrgId || '',
                                selectedOrgName: refreshState.selectedOrgName || '',
                                selectedProjectId: refreshState.selectedProjectId,
                                selectedProjectName: refreshState.selectedProjectName,
                                selectedBranchId: refreshState.selectedBranchId,
                                selectedBranchName: refreshState.selectedBranchName,
                                parentBranchId: refreshState.parentBranchId,
                                parentBranchName: refreshState.parentBranchName
                            }
                        });
                        await this.updateView();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to refresh projects: ${error}`);
                    }
                    break;

                case 'refreshBranches':
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        const branches = await apiService.getBranches(message.projectId);
                        const refreshState = await this._stateService.getViewData();
                        
                        await this._stateService.updateState({
                            selection: {
                                orgs: refreshState.orgs,
                                projects: refreshState.projects,
                                branches: branches,
                                selectedOrgId: refreshState.selectedOrgId || '',
                                selectedOrgName: refreshState.selectedOrgName || '',
                                selectedProjectId: refreshState.selectedProjectId,
                                selectedProjectName: refreshState.selectedProjectName,
                                selectedBranchId: refreshState.selectedBranchId,
                                selectedBranchName: refreshState.selectedBranchName,
                                parentBranchId: refreshState.parentBranchId,
                                parentBranchName: refreshState.parentBranchName
                            }
                        });
                        await this.updateView();
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to refresh branches: ${error}`);
                    }
                    break;

                case 'updatePort':
                    await this._stateService.setPort(message.port);
                    await this.updateView();
                    break;
                case 'startProxy':
                    await this._stateService.setIsStarting(true);
                    try {
                        // Show notification that we're connecting
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: "Connecting to your Neon database",
                            cancellable: false
                        }, async (progress) => {
                            try {
                                // Get the current state before connecting
                                const currentState = await this._stateService.getViewData();
                                
                                progress.report({ message: "Fetching connection information..." });
                                
                                // Get branch ID from message
                                const branchId = message.branchId;
                                const projectId = this._stateService.currentProject;
                                
                                console.debug('🔍 Connecting to branch:', branchId, 'project:', projectId);

                                // Set currently connected branch and current branch
                                await this._stateService.setCurrentlyConnectedBranch(branchId);
                                await this._stateService.setCurrentBranch(message.branchId);

                                // Fetch connection info, databases, and roles from Neon API
                                const apiService = new NeonApiService(this._extensionContext);
                                console.debug('🔍 Fetching connection info, databases, and roles...');
                                
                                const [connectionInfos, databases, roles] = await Promise.all([
                                    apiService.getBranchConnectionInfo(projectId, branchId),
                                    apiService.getDatabases(projectId, branchId),
                                    apiService.getRoles(projectId, branchId)
                                ]);

                                console.debug('✅ Fetched connection info:', connectionInfos);
                                console.debug('✅ Fetched databases:', databases);
                                console.debug('✅ Fetched roles:', roles);

                                // Store connection info in state
                                await this._stateService.setBranchConnectionInfos(connectionInfos);

                                // Build connection string for display (using first database)
                                const firstConnection = connectionInfos[0];
                                const connectionString = firstConnection 
                                    ? `postgresql://${firstConnection.user}:${firstConnection.password}@${firstConnection.host}/${firstConnection.database}?sslmode=require`
                                    : '';

                                progress.report({ message: "Updating connection state..." });

                                // Update the connection state
                                const currentFullState = await this._stateService.getViewData();
                                await this._stateService.updateState({
                                    selection: {
                                        orgs: currentState.orgs,
                                        projects: currentState.projects,
                                        branches: currentState.branches,
                                        selectedOrgId: currentState.selectedOrgId || '',
                                        selectedOrgName: currentState.selectedOrgName || '',
                                        selectedProjectId: currentState.selectedProjectId,
                                        selectedProjectName: currentState.selectedProjectName,
                                        selectedBranchId: currentState.selectedBranchId,
                                        selectedBranchName: currentState.selectedBranchName,
                                        parentBranchId: currentState.parentBranchId,
                                        parentBranchName: currentState.parentBranchName
                                    },
                                    connection: {
                                        ...currentFullState.connection,
                                        connected: true,
                                        connectionInfo: connectionString,
                                        databases,
                                        roles,
                                        connectedOrgId: currentState.selectedOrgId || '',
                                        connectedOrgName: currentState.selectedOrgName || '',
                                        connectedProjectId: currentState.selectedProjectId || '',
                                        connectedProjectName: currentState.selectedProjectName || '',
                                        branchConnectionInfos: connectionInfos,
                                        selectedDatabase: databases.length > 0 ? databases[0].name : ''
                                    }
                                });

                                // Mark as connected
                                await this._stateService.setIsProxyRunning(true);

                                // Update the view to reflect the connection
                                await this.updateView();
                                
                                vscode.window.showInformationMessage('Successfully connected to Neon database!');
                            } catch (progressError) {
                                // Re-throw the error to be handled by the outer catch block
                                throw progressError;
                            }
                        });
                    } catch (error) {
                        console.error('Error connecting to database:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to connect: ${error.message}`);
                        }
                    } finally {
                        await this._stateService.setIsStarting(false);
                        await this.updateView();
                    }
                    break;
                case 'stopProxy':
                    // Clear connection state
                    await this._stateService.setBranchConnectionInfos([]);
                    await this._stateService.setIsProxyRunning(false);
                    await this._stateService.setCurrentlyConnectedBranch('');
                    await this.updateView();
                    vscode.window.showInformationMessage('Disconnected from Neon database');
                    break;
                case 'selectConnectionDatabaseRole':
                    await this.handleSelectConnectionDatabaseRole(message.currentDatabase, message.currentRole);
                    break;
                case 'updateConnectionType':
                    console.debug('ConnectViewProvider: Handling connection type update:', {
                        newType: message.connectionType,
                        currentType: this._lastRequestedConnectionType
                    });
                    // Store the requested connection type
                    this._lastRequestedConnectionType = message.connectionType;
                    // Update the connection type through the state service
                    await this._stateService.setConnectionType(message.connectionType);
                    // Update the view to reflect the change
                    await this.updateView();
                    break;
                case 'requestInitialData':
                    await this.updateView();
                    break;
                case 'getWorkspaceInfo':
                    await this.sendWorkspaceInfo();
                    break;
                case 'getTabPreference':
                    await this.sendTabPreference();
                    break;
                case 'saveTabPreference':
                    await this.saveTabPreference(message.tab);
                    break;
                case 'scanWorkspaceForConnections':
                    await this.scanAndSendConnections();
                    break;
                case 'backgroundScanWorkspaceForConnections':
                    // Background scan - clears cache but doesn't show loading screen
                    this._detectedConnectionsCache = undefined;
                    this._endpointInfoCache.clear();
                    console.debug('Background scan: cleared cache, scanning silently...');
                    await this.scanAndSendConnections();
                    break;
                case 'refreshWorkspaceConnections':
                    // Clear the cache first
                    this._detectedConnectionsCache = undefined;
                    this._endpointInfoCache.clear();
                    console.debug('Cleared workspace connections cache, starting fresh scan...');
                    
                    // Notify frontend that scanning has started
                    if (this._view) {
                        this._view.webview.postMessage({
                            command: 'scanningStarted'
                        });
                    }
                    
                    // Re-scan (with a small delay to ensure UI updates)
                    await new Promise(resolve => setTimeout(resolve, 50));
                    await this.scanAndSendConnections();
                    break;
                case 'openChatWithPrompt':
                    try {
                        const apiService = new NeonApiService(this._extensionContext);
                        
                        // Fetch organizations
                        let orgs: NeonOrg[] = [];
                        try {
                            orgs = await apiService.getOrgs();
                        } catch (error) {
                            console.error('Failed to fetch orgs for chat prompt:', error);
                        }
                        
                        let selectedOrgId: string | undefined;
                        let selectedOrgName: string | undefined;
                        
                        // If more than one org, show picker
                        if (orgs.length > 1) {
                            const orgPick = await vscode.window.showQuickPick(
                                orgs.map(org => ({
                                    label: org.name,
                                    description: org.id,
                                    id: org.id
                                })),
                                {
                                    title: 'Select Organization',
                                    placeHolder: 'Choose an organization for your new Neon project'
                                }
                            );
                            
                            if (!orgPick) {
                                return; // User cancelled
                            }
                            
                            selectedOrgId = orgPick.id;
                            selectedOrgName = orgPick.label;
                        } else if (orgs.length === 1) {
                            // Auto-select the only org
                            selectedOrgId = orgs[0].id;
                            selectedOrgName = orgs[0].name;
                        }
                        
                        // Fetch projects for the selected org
                        let selectedProjectId: string | undefined;
                        let selectedProjectName: string | undefined;
                        let isNewProject = false;
                        
                        if (selectedOrgId) {
                            try {
                                const projects = await apiService.getProjects(selectedOrgId);
                                
                                // Build project options with "Create new project" at the top
                                const projectOptions: vscode.QuickPickItem[] = [
                                    {
                                        label: '$(add) Create new project',
                                        description: 'Start fresh with a new Neon project',
                                        alwaysShow: true
                                    },
                                    { kind: vscode.QuickPickItemKind.Separator, label: 'Existing projects' },
                                    ...projects.map(project => ({
                                        label: project.name,
                                        description: project.id
                                    }))
                                ];
                                
                                const projectPick = await vscode.window.showQuickPick(
                                    projectOptions,
                                    {
                                        title: 'Select Project',
                                        placeHolder: 'Choose a project or create a new one'
                                    }
                                );
                                
                                if (!projectPick) {
                                    return; // User cancelled
                                }
                                
                                if (projectPick.label.includes('Create new project')) {
                                    isNewProject = true;
                                    selectedProjectName = 'New project';
                                } else {
                                    selectedProjectId = projectPick.description;
                                    selectedProjectName = projectPick.label;
                                }
                            } catch (error) {
                                console.error('Failed to fetch projects:', error);
                                // Continue without project selection
                            }
                        }
                        
                        // Build the prompt with org/project info
                        let prompt = 'Get started with Neon.';
                        if (selectedOrgId) {
                            if (isNewProject) {
                                prompt += ` Using Neon org ${selectedOrgId} and create a new Neon project.`;
                            } else if (selectedProjectId) {
                                prompt += ` Using Neon org ${selectedOrgId} and project ${selectedProjectId}.`;
                            }
                        }
                        
                        console.debug('Built prompt:', prompt);
                        
                        // Copy prompt to clipboard first
                        await vscode.env.clipboard.writeText(prompt);
                        console.debug('Copied prompt to clipboard:', prompt);
                        
                        // Try to open Cursor chat and paste the prompt
                        try {
                            // Open Cursor's chat
                            await vscode.commands.executeCommand('aichat.newchataction');
                            console.debug('Opened Cursor chat');
                            
                            // Give chat a moment to open and focus, then paste from clipboard
                            setTimeout(async () => {
                                try {
                                    // Use clipboard paste action to insert the prompt
                                    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                                    console.debug('Pasted prompt into chat');
                                } catch (pasteError) {
                                    console.debug('Could not auto-paste prompt:', pasteError);
                                    // Fallback: show message that prompt is on clipboard
                                    vscode.window.showInformationMessage(`Prompt copied to clipboard - press Cmd+V to paste`);
                                }
                            }, 150);
                        } catch (cursorError) {
                            console.debug('Cursor chat command failed, trying VS Code:', cursorError);
                            // Fallback: Try VS Code Copilot chat
                            try {
                                await vscode.commands.executeCommand('workbench.panel.chat.view.copilot.focus');
                                await vscode.commands.executeCommand('workbench.action.chat.open');
                                
                                // Try to paste after chat opens
                                setTimeout(async () => {
                                    try {
                                        await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                                    } catch (pasteError) {
                                        console.debug('Could not auto-paste in VS Code chat');
                                    }
                                }, 150);
                                
                                console.debug('Opened VS Code chat');
                            } catch (vscodeError) {
                                console.debug('VS Code chat failed:', vscodeError);
                                vscode.window.showInformationMessage(`Prompt copied to clipboard! Open chat and paste.`);
                            }
                        }
                    } catch (error) {
                        console.error('Error opening chat:', error);
                        vscode.window.showErrorMessage('Failed to open chat. Try opening it manually.');
                    }
                    break;
                case 'createNewBranch':
                    try {
                        // Show input box for branch name
                        const branchName = await vscode.window.showInputBox({
                            prompt: 'Enter a name for the new branch',
                            placeHolder: 'e.g., feature/my-new-branch',
                            validateInput: text => {
                                return text ? null : 'Branch name is required';
                            }
                        });

                        if (!branchName) {
                            return; // User cancelled
                        }

                        // Get current state for branch list
                        const currentState = await this._stateService.getViewData();
                        
                        // Create QuickPick for parent branch selection
                        const parentBranch = await vscode.window.showQuickPick(
                            currentState.branches.map(branch => ({
                                label: branch.name,
                                description: `Branch ID: ${branch.id}`,
                                detail: branch.name === 'main' ? '(Default parent branch)' : undefined,
                                id: branch.id
                            })), {
                                title: 'Select Parent Branch',
                                placeHolder: 'Choose a parent branch for the new branch',
                                ignoreFocusOut: true
                            }
                        );

                        if (!parentBranch) {
                            return; // User cancelled
                        }

                        try {
                            // Create the branch
                            const apiService = new NeonApiService(this._extensionContext);
                            const newBranch = await apiService.createBranch(message.projectId, parentBranch.id, branchName);
                            
                            // Refresh the branches list
                            const branches = await apiService.getBranches(message.projectId);
                            await this._stateService.setBranches(branches);
                            
                            // Select the new branch
                            await this._stateService.setCurrentBranch(newBranch.id);
                            await this._stateService.updateState({
                                selection: {
                                    orgs: currentState.orgs,
                                    projects: currentState.projects,
                                    branches: branches,
                                    selectedOrgId: currentState.selectedOrgId || '',
                                    selectedOrgName: currentState.selectedOrgName || '',
                                    selectedProjectId: currentState.selectedProjectId,
                                    selectedProjectName: currentState.selectedProjectName,
                                    selectedBranchId: newBranch.id,
                                    selectedBranchName: newBranch.name,
                                    parentBranchId: currentState.parentBranchId,
                                    parentBranchName: currentState.parentBranchName
                                }
                            });

                            // Update the view
                            await this.updateView();
                            
                            vscode.window.showInformationMessage(`Branch "${branchName}" created successfully.`);
                        } catch (error) {
                            console.error('Error creating new branch:', error);
                            if (error instanceof Error) {
                                vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
                            }
                        }
                    } catch (error) {
                        console.error('Error in branch creation flow:', error);
                        if (error instanceof Error) {
                            vscode.window.showErrorMessage(`Failed to create branch: ${error.message}`);
                        }
                    }
                    break;
            }
        } catch (error) {
            console.error('Error handling webview message:', error);
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Error: ${error.message}`);
            }
        }
    }

    public dispose(): void {
        if (this._updateViewTimeout) {
            clearTimeout(this._updateViewTimeout);
        }
        if (this._connectionTypeUpdateTimeout) {
            clearTimeout(this._connectionTypeUpdateTimeout);
        }
        this._authStateChangeDisposable?.dispose();
    }

    private async handleSelectConnectionDatabaseRole(currentDatabase: string, currentRole: string): Promise<void> {
        try {
            const viewData = await this._stateService.getViewData();
            let connectionInfos = viewData.connection.branchConnectionInfos;

            if (!connectionInfos || connectionInfos.length === 0) {
                vscode.window.showWarningMessage('No connection information available');
                return;
            }

            // Fetch fresh connection info to ensure we have the latest databases
            // This handles the case where a database was just created
            try {
                console.debug('Fetching fresh connection info for database/role selection...');
                const apiService = new NeonApiService(this._extensionContext);
                const projectId = await this._stateService.getCurrentProjectId();
                const branchId = await this._stateService.currentlyConnectedBranch;
                
                if (projectId && branchId) {
                    const freshConnectionInfos = await apiService.getBranchConnectionInfo(projectId, branchId);
                    await this._stateService.setBranchConnectionInfos(freshConnectionInfos);
                    connectionInfos = freshConnectionInfos;
                    console.debug(`Refreshed connection info: Found ${connectionInfos.length} connection configurations`);
                }
            } catch (refreshError) {
                console.error('Error refreshing connection info:', refreshError);
                // Continue with existing data
            }

            // Get unique databases
            const databases = Array.from(new Set(connectionInfos.map(info => info.database)));

            if (databases.length === 0) {
                vscode.window.showWarningMessage('No databases available');
                return;
            }

            // Show database picker
            const selectedDatabase = await vscode.window.showQuickPick(
                databases.map(db => ({
                    label: db,
                    description: db === currentDatabase ? '(Current)' : undefined
                })),
                {
                    placeHolder: 'Select a database',
                    title: 'Select Database'
                }
            );

            if (!selectedDatabase) {
                return; // User cancelled
            }

            // Get roles for the selected database
            const rolesForDatabase = connectionInfos
                .filter(info => info.database === selectedDatabase.label)
                .map(info => info.user);

            const uniqueRoles = Array.from(new Set(rolesForDatabase));

            if (uniqueRoles.length === 0) {
                vscode.window.showWarningMessage(`No roles found for database ${selectedDatabase.label}`);
                return;
            }

            // Show role picker
            const selectedRole = await vscode.window.showQuickPick(
                uniqueRoles.map(role => ({
                    label: role,
                    description: role === currentRole && selectedDatabase.label === currentDatabase ? '(Current)' : undefined
                })),
                {
                    placeHolder: 'Select a role',
                    title: 'Select Role'
                }
            );

            if (!selectedRole) {
                return; // User cancelled
            }

            // Send the selected database and role back to the webview
            if (this._view) {
                this._view.webview.postMessage({
                    command: 'updateConnectionDatabaseRole',
                    database: selectedDatabase.label,
                    role: selectedRole.label
                });
            }
        } catch (error) {
            console.error('Error selecting database/role:', error);
            vscode.window.showErrorMessage(`Failed to select database/role: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private getWebviewContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js')
        );

        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'dist', 'styles.css')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-eval'; img-src ${webview.cspSource} data: https:; font-src ${webview.cspSource}; connect-src 'self';">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Neon - Serverless Postgres</title>
            </head>
            <body data-view-type="${VIEW_TYPES.CONNECT}">
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }

    public async updateView(): Promise<void> {
        console.debug('ConnectViewProvider: Starting updateView');
        if (!this._view || this._isUpdating) {
            console.debug('ConnectViewProvider: Skipping update - view not ready or already updating');
            return;
        }

        this._isUpdating = true;
        console.debug('ConnectViewProvider: Set _isUpdating flag');

        try {
            // Use AuthManager to check authentication state consistently
            const isAuthenticated = await this._authManager.isAuthenticatedAsync();
            console.debug('ConnectViewProvider: Authentication state check in updateView', { isAuthenticated });

            if (!isAuthenticated) {
                console.debug('ConnectViewProvider: Not authenticated, showing sign-in message');
                if (this._view && this._signInView) {
                    this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your Neon branch", true);
                }
                return;
            }

            // User is authenticated (either via OAuth or persistent API key), show connect view
            console.debug('ConnectViewProvider: User is authenticated, showing connect view');
            if (this._view.webview.html.includes('sign-in-button')) {
                console.debug('ConnectViewProvider: Transitioning from sign-in to connect view');
                this._view.webview.html = this.getWebviewContent(this._view.webview);
                
                // Initialize state with empty selections
                await this._stateService.updateState({
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
                });
            }

            // Get the current view data
            console.debug('ConnectViewProvider: Getting view data');
            const viewData = await this._stateService.getViewData();
            await this._webviewService.updateWebview(this._view, viewData);
        } catch (error) {
            console.error('ConnectViewProvider: Error updating view', error);
            Logger.error('Failed to update view', error);
            
            if (this._view && this._signInView) {
                this._view.webview.html = this._signInView.getHtml("Sign in to your Neon account to connect to your Neon branch", true);
            }
        } finally {
            this._isUpdating = false;
        }
    }

    /**
     * Public method to trigger refresh from title bar command
     */
    public async refresh(): Promise<void> {
        if (!this._view) {
            return;
        }

        // Post message to webview to trigger the refresh handler
        this._view.webview.postMessage({
            command: 'triggerRefresh'
        });
    }

    private async sendWorkspaceInfo() {
        if (!this._view) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceName = workspaceFolders && workspaceFolders.length > 0
            ? path.basename(workspaceFolders[0].uri.fsPath)
            : '';

        this._view.webview.postMessage({
            command: 'workspaceInfo',
            workspaceName
        });
    }

    private async sendTabPreference() {
        if (!this._view) {
            return;
        }

        // Get the saved tab preference from global state (defaults to 'app' if not set)
        const savedTab = this._extensionContext.globalState.get<'app' | 'allBranches'>('connectView.activeTab');
        console.debug('Sending tab preference:', savedTab);

        this._view.webview.postMessage({
            command: 'tabPreference',
            tab: savedTab // Will be undefined if not set, frontend defaults to 'app'
        });
    }

    private async saveTabPreference(tab: 'app' | 'allBranches') {
        console.debug('Saving tab preference:', tab);
        await this._extensionContext.globalState.update('connectView.activeTab', tab);
    }

    private async scanAndSendConnections() {
        if (!this._view) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            this._view.webview.postMessage({
                command: 'detectedConnections',
                connections: []
            });
            return;
        }

        // Check cache first (cache expires after 5 minutes)
        const cacheMaxAge = 5 * 60 * 1000; // 5 minutes
        if (this._detectedConnectionsCache && (Date.now() - this._detectedConnectionsCache.timestamp) < cacheMaxAge) {
            console.debug('Using cached detected connections');
            this._view.webview.postMessage({
                command: 'detectedConnections',
                connections: this._detectedConnectionsCache.connections
            });
            return;
        }

        console.debug('Scanning workspace for connections...');
        const detectedConnections: Array<{
            file: string;
            connectionString: string;
            database?: string;
            projectId?: string;
            branchId?: string;
            endpointId?: string;
            projectName?: string;
            branchName?: string;
            orgName?: string;
            orgId?: string;
            error?: string;
        }> = [];

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        
        // Regex to match Neon connection strings
        const neonConnRegex = /postgres(ql)?:\/\/[^:]+:[^@]+@[^\/]+\.neon\.tech[^\s"'\n)}\]]+/gi;
        
        // Files and patterns to check
        const filesToCheck = [
            '.env',
            '.env.local',
            '.env.development',
            '.env.production',
            'config.json',
            'config.yaml',
            'config.yml',
            'database.json',
            'database.yml',
            '.env.example',
            'next.config.js',
            'next.config.ts',
            'nuxt.config.js',
            'nuxt.config.ts',
            'prisma/schema.prisma',
            'drizzle.config.ts',
            'drizzle.config.js'
        ];

        // First pass: find all connection strings (before API enrichment)
        let totalConnectionsFound = 0;
        for (const file of filesToCheck) {
            const filePath = path.join(workspaceRoot, file);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const matches = content.match(neonConnRegex);
                    if (matches) {
                        totalConnectionsFound += matches.length;
                    }
                } catch (error) {
                    // Ignore read errors for now, we'll handle them in the detailed pass
                }
            }
        }

        // If connection strings were found, notify frontend to show loading state
        // while API calls happen for enrichment
        if (totalConnectionsFound > 0 && this._view) {
            console.debug(`Found ${totalConnectionsFound} connection strings, enriching with API data...`);
            this._view.webview.postMessage({
                command: 'connectionStringsFound',
                count: totalConnectionsFound
            });
        }

        // Second pass: extract details and enrich with API data
        for (const file of filesToCheck) {
            const filePath = path.join(workspaceRoot, file);
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const matches = content.match(neonConnRegex);
                    
                    if (matches) {
                        for (const match of matches) {
                            // Parse connection string to extract info
                            const urlMatch = match.match(/postgres(ql)?:\/\/([^:]+):([^@]+)@([^\/]+)\/([^\?]+)/);
                            let database: string | undefined;
                            let endpointId: string | undefined;

                            if (urlMatch) {
                                const hostname = urlMatch[4];
                                database = urlMatch[5].split('?')[0];
                                
                                // Extract endpoint ID from hostname (format: ep-xxx-xxx-xxx.region.aws.neon.tech or ep-xxx-xxx-xxx-pooler.region.aws.neon.tech)
                                const hostMatch = hostname.match(/(ep-[^\.]+)\./);
                                if (hostMatch) {
                                    // Remove -pooler suffix if present
                                    endpointId = hostMatch[1].replace(/-pooler$/, '');
                                }
                            }

                            // Create initial entry
                            const connection: any = {
                                file: path.relative(workspaceRoot, filePath),
                                connectionString: match,
                                database,
                                endpointId
                            };

                            // Try to fetch additional info from API if we have an endpoint ID
                            if (endpointId) {
                                // Check cache first (cache expires after 1 hour)
                                const cached = this._endpointInfoCache.get(endpointId);
                                const cacheMaxAge = 60 * 60 * 1000; // 1 hour
                                
                                if (cached && (Date.now() - cached.timestamp) < cacheMaxAge) {
                                    console.debug(`Using cached endpoint info for ${endpointId}`);
                                    connection.projectId = cached.projectId;
                                    connection.branchId = cached.branchId;
                                    connection.projectName = cached.projectName;
                                    connection.branchName = cached.branchName;
                                    connection.orgName = cached.orgName;
                                    connection.orgId = cached.orgId;
                                    connection.error = cached.error;
                                } else {
                                    try {
                                        const apiService = new NeonApiService(this._extensionContext);
                                        const endpointInfo = await apiService.getEndpointInfo(endpointId);
                                        
                                        if (endpointInfo) {
                                            connection.projectId = endpointInfo.project_id;
                                            connection.branchId = endpointInfo.branch_id;
                                            
                                            // Get project info to get org and project name
                                            if (endpointInfo.project_id) {
                                                try {
                                                    const projectInfo = await apiService.getProject(endpointInfo.project_id);
                                                    if (projectInfo) {
                                                        connection.projectName = projectInfo.name;
                                                        connection.orgId = projectInfo.org_id;
                                                        
                                                        // Get org name
                                                        if (projectInfo.org_id) {
                                                            const orgs = await apiService.getOrgs();
                                                            const org = orgs.find((o: any) => o.id === projectInfo.org_id);
                                                            connection.orgName = org?.name;
                                                            if (!org) {
                                                                connection.error = 'Organization not accessible';
                                                            }
                                                        }
                                                    } else {
                                                        connection.error = 'Project not found or not accessible';
                                                    }
                                                } catch (error: any) {
                                                    console.warn('Failed to get project info:', error);
                                                    connection.error = error.message?.includes('404') 
                                                        ? 'Project not found or deleted' 
                                                        : 'Project not accessible';
                                                }
                                            }
                                            
                                            // Get branch name
                                            if (endpointInfo.project_id && endpointInfo.branch_id && !connection.error) {
                                                try {
                                                    const branchInfo = await apiService.getBranch(endpointInfo.project_id, endpointInfo.branch_id);
                                                    if (branchInfo) {
                                                        connection.branchName = branchInfo.name;
                                                    } else {
                                                        connection.error = 'Branch not found or deleted';
                                                    }
                                                } catch (error: any) {
                                                    console.warn('Failed to get branch info:', error);
                                                    connection.error = error.message?.includes('404')
                                                        ? 'Branch not found or deleted'
                                                        : 'Branch not accessible';
                                                }
                                            }
                                            
                                            // Cache the results (including error state)
                                            this._endpointInfoCache.set(endpointId, {
                                                projectId: connection.projectId,
                                                branchId: connection.branchId,
                                                projectName: connection.projectName,
                                                branchName: connection.branchName,
                                                orgName: connection.orgName,
                                                orgId: connection.orgId,
                                                error: connection.error,
                                                timestamp: Date.now()
                                            });
                                            console.debug(`Cached endpoint info for ${endpointId}`, connection.error ? `(error: ${connection.error})` : '');
                                        } else {
                                            connection.error = 'Endpoint not found';
                                            // Cache the error to avoid repeated lookups
                                            this._endpointInfoCache.set(endpointId, {
                                                error: connection.error,
                                                timestamp: Date.now()
                                            });
                                        }
                                    } catch (error: any) {
                                        console.warn('Failed to get endpoint info:', error);
                                        // Determine specific error message
                                        if (error.message?.includes('404')) {
                                            connection.error = 'Endpoint not found - project may be deleted';
                                        } else if (error.message?.includes('403') || error.message?.includes('401')) {
                                            connection.error = 'Not authorized to access this project';
                                        } else {
                                            connection.error = 'Could not verify connection';
                                        }
                                        // Cache the error to avoid repeated lookups
                                        this._endpointInfoCache.set(endpointId, {
                                            error: connection.error,
                                            timestamp: Date.now()
                                        });
                                    }
                                }
                            }

                            detectedConnections.push(connection);
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to read file ${file}:`, error);
                }
            }
        }

        // Cache the results
        this._detectedConnectionsCache = {
            connections: detectedConnections,
            timestamp: Date.now()
        };
        console.debug(`Cached ${detectedConnections.length} detected connections`);

        // Also refresh branches for detected projects so they're available in state
        // BEFORE sending detectedConnections to the frontend
        const validConnections = detectedConnections.filter(c => !c.error);
        const detectedProjectIds = [...new Set(validConnections.filter(c => c.projectId).map(c => c.projectId as string))];
        
        if (detectedProjectIds.length > 0) {
            console.debug(`Refreshing branches for ${detectedProjectIds.length} detected projects...`);
            
            for (const projectId of detectedProjectIds) {
                try {
                    const apiService = new NeonApiService(this._extensionContext);
                    const branches = await apiService.getBranches(projectId);
                    const refreshState = await this._stateService.getViewData();
                    
                    console.debug(`Fetched ${branches.length} branches for project ${projectId}`);
                    
                    await this._stateService.updateState({
                        selection: {
                            orgs: refreshState.orgs,
                            projects: refreshState.projects,
                            branches: branches,
                            selectedOrgId: refreshState.selectedOrgId || '',
                            selectedOrgName: refreshState.selectedOrgName || '',
                            selectedProjectId: refreshState.selectedProjectId,
                            selectedProjectName: refreshState.selectedProjectName,
                            selectedBranchId: refreshState.selectedBranchId,
                            selectedBranchName: refreshState.selectedBranchName,
                            parentBranchId: refreshState.parentBranchId,
                            parentBranchName: refreshState.parentBranchName
                        }
                    });
                } catch (error) {
                    console.warn(`Failed to refresh branches for project ${projectId}:`, error);
                }
            }
            
            // Update view to send branches to frontend before sending detectedConnections
            await this.updateView();
        }

        this._view.webview.postMessage({
            command: 'detectedConnections',
            connections: detectedConnections
        });
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
} 