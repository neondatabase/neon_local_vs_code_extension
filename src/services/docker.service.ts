import * as vscode from 'vscode';
import Docker from 'dockerode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { StateService } from './state.service';
import { AuthManager } from '../auth/authManager';
import { ConfigurationManager } from '../utils';
import { FileService } from './file.service';

export class DockerService {
    private docker: Docker;
    private containerName = 'neon_local_vscode';
    private context: vscode.ExtensionContext;
    private stateService: StateService;
    private fileService: FileService;
    private statusCheckInterval: NodeJS.Timeout | null = null;

    constructor(context: vscode.ExtensionContext, stateService: StateService) {
        this.docker = new Docker();
        this.context = context;
        this.stateService = stateService;
        this.fileService = new FileService(context);
    }

    /**
     * Attempts to read Docker Hub credentials from the local Docker CLI configuration.
     * Supports both legacy "auths" (base64 encoded username:password) entries **and**
     * credential helpers / credential stores (e.g. osxkeychain, desktop, pass).
     *
     * Returns `null` if no credentials could be found. In that case Docker will attempt
     * to pull the image anonymously which might still succeed but can be subject to
     * stricter rate-limits.
     */
    private getDockerAuthConfig(): { username: string; password: string } | null {
        try {
            const cfgPath = path.join(os.homedir(), '.docker', 'config.json');
            if (!fs.existsSync(cfgPath)) {
                return null;
            }

            const cfgRaw = fs.readFileSync(cfgPath, 'utf8');
            const cfg = JSON.parse(cfgRaw);

            // 1. Look for inline auths (base64 encoded)
            const registryHosts = [
                'https://index.docker.io/v1/',
                'https://registry-1.docker.io',
                'registry-1.docker.io'
            ];

            for (const host of registryHosts) {
                const entry = cfg.auths?.[host];
                if (entry?.auth) {
                    const decoded = Buffer.from(entry.auth, 'base64').toString();
                    const [username, password] = decoded.split(':');
                    if (username && password) {
                        return { username, password };
                    }
                }
            }

            // 2. Fall back to generic credential store
            const tryCredHelper = (helperName: string): { username: string; password: string } | null => {
                try {
                    const helperCmd = `docker-credential-${helperName}`;
                    const output = execSync(`${helperCmd} get`, {
                        input: 'https://index.docker.io/v1/\n',
                        stdio: ['pipe', 'pipe', 'ignore']
                    }).toString();
                    const creds = JSON.parse(output);
                    if (creds?.Username && creds?.Secret) {
                        return { username: creds.Username, password: creds.Secret };
                    }
                } catch (err) {
                    // Ignore helper errors – simply treat as no credentials
                }
                return null;
            };

            if (cfg.credsStore) {
                const res = tryCredHelper(cfg.credsStore);
                if (res) return res;
            }

            if (cfg.credHelpers && typeof cfg.credHelpers === 'object') {
                const helperName = cfg.credHelpers['https://index.docker.io/v1/'] || cfg.credHelpers['registry-1.docker.io'];
                if (helperName) {
                    const res = tryCredHelper(helperName);
                    if (res) return res;
                }
            }

            return null;
        } catch (err) {
            console.error('Failed to read Docker credentials:', err);
            return null;
        }
    }

    async checkContainerStatus(): Promise<boolean> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            const containerInfo = await container.inspect();
            return containerInfo.State.Running;
        } catch (error) {
            return false;
        }
    }

    async getCurrentDriver(): Promise<'postgres' | 'serverless'> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            const containerInfo = await container.inspect();
            
            // Find the DRIVER environment variable
            const driverEnv = containerInfo.Config.Env.find((env: string) => env.startsWith('DRIVER='));
            if (!driverEnv) {
                return 'postgres'; // Default to postgres if not found
            }
            
            const driver = driverEnv.split('=')[1];
            return driver === 'serverless' ? 'serverless' : 'postgres';
        } catch (error) {
            console.error('Error getting current driver:', error);
            return 'postgres'; // Default to postgres on error
        }
    }

    public async startStatusCheck(): Promise<void> {
        // Clear any existing interval
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
        }

        // Start periodic status check every 5 seconds
        this.statusCheckInterval = setInterval(async () => {
            try {
                const isRunning = await this.checkContainerStatus();
                if (!isRunning) {
                    console.debug('Container is no longer running, updating state...');
                    await this.stateService.setIsProxyRunning(false);
                    // Delete the .branches file when container is no longer running
                    await this.fileService.deleteBranchesFile();
                    this.stopStatusCheck();
                }
            } catch (error) {
                console.error('Error checking container status:', error);
            }
        }, 5000);
    }

    private stopStatusCheck(): void {
        if (this.statusCheckInterval) {
            clearInterval(this.statusCheckInterval);
            this.statusCheckInterval = null;
        }
    }

    public async startContainer(options: {
        branchId: string;
        driver: string;
        isExisting: boolean;
        context: vscode.ExtensionContext;
        projectId: string;
        port: number;
    }): Promise<void> {
        try {
            console.debug('Starting container with options:', options);
            
            // Create the .neon_local directory if it doesn't exist
            const neonLocalPath = path.join(options.context.globalStorageUri.fsPath, '.neon_local');
            if (!fs.existsSync(neonLocalPath)) {
                await fs.promises.mkdir(neonLocalPath, { recursive: true });
            }

            // Start the container
            await this.startProxy(options);

            // Wait for container to be ready
            await this.waitForContainer();

            // For new branches, we need to wait for the .branches file to be populated
            if (!options.isExisting) {
                console.debug('🔍 Waiting for ephemeral branch .branches file to be populated...');
                
                // Wait for the .branches file to be populated with the ephemeral branch ID
                const branchId = await this.waitForBranchesFile(options.context);
                if (!branchId) {
                    throw new Error('Failed to get ephemeral branch ID from .branches file within timeout period');
                }
                
                console.debug('✅ Ephemeral branch .branches file populated with branch ID:', branchId);
            } else {
                // For existing branches, check if we have a branch ID in the file
                const branchId = await this.checkBranchesFile(options.context);
                if (branchId) {
                    console.debug('✅ Using existing branch ID from .branches file:', branchId);
                }
            }

            // Set proxy running state
            await this.stateService.setIsProxyRunning(true);
            await this.stateService.setIsStarting(false);

            console.debug('Container started successfully');
        } catch (error) {
            console.error('Error starting container:', error);
            await this.stateService.setIsStarting(false);
            
            // If this is a branch limit error, clean up the container
            if (error instanceof Error && error.message.includes('Unable to create ephemeral branch, as you have reached your Branch limit')) {
                console.debug('Branch limit error detected, cleaning up container...');
                try {
                    //await this.cleanupContainer();
                } catch (cleanupError) {
                    console.error('Error cleaning up container after branch limit error:', cleanupError);
                }
            }
            
            throw error;
        }
    }

    async stopContainer(): Promise<void> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            await container.stop({ t: 20 }); // 20 second grace period
            await container.remove();

            // Clear connection-related state but preserve branch selection
            await this.stateService.setIsProxyRunning(false);
            await this.stateService.setConnectionInfo({
                connectionInfo: '',
                selectedDatabase: ''
            });
            await this.stateService.setCurrentlyConnectedBranch('');
            await this.stateService.setDatabases([]);
            await this.stateService.setRoles([]);
            
            // Stop periodic status check
            this.stopStatusCheck();
            
            // Delete the .branches file
            await this.fileService.deleteBranchesFile();
            
            console.debug('Container stopped successfully');
        } catch (error) {
            // If the container doesn't exist, that's fine - just update the state
            if ((error as any).statusCode === 404) {
                await this.stateService.setIsProxyRunning(false);
                await this.stateService.setConnectionInfo({
                    connectionInfo: '',
                    selectedDatabase: ''
                });
                await this.stateService.setCurrentlyConnectedBranch('');
                await this.stateService.setDatabases([]);
                await this.stateService.setRoles([]);
                this.stopStatusCheck();
                // Delete the .branches file even if container doesn't exist
                await this.fileService.deleteBranchesFile();
                return;
            }
            console.error('Error stopping container:', error);
            throw error;
        }
    }

    private async cleanupContainer(): Promise<void> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            console.debug('Stopping and removing container due to error...');
            
            try {
                await container.stop({ t: 20 }); // 20 second grace period
            } catch (stopError) {
                // Container might already be stopped, that's fine
                console.debug('Container may already be stopped:', stopError);
            }
            
            await container.remove({ force: true });
            
            // Delete the .branches file
            await this.fileService.deleteBranchesFile();
            
            console.debug('Container cleaned up successfully');
        } catch (error) {
            // If the container doesn't exist, that's fine
            if ((error as any).statusCode === 404) {
                console.debug('Container does not exist, no cleanup needed');
                // Delete the .branches file even if container doesn't exist
                await this.fileService.deleteBranchesFile();
                return;
            }
            console.error('Error during container cleanup:', error);
            throw error;
        }
    }

    /**
     * Checks if we need to check for image updates today.
     * Returns true if the last update check was more than 24 hours ago.
     */
    private async shouldCheckForImageUpdate(): Promise<boolean> {
        const lastCheckKey = 'neonLocal.lastImageUpdateCheck';
        const lastCheck = this.context.globalState.get<string>(lastCheckKey);
        
        if (!lastCheck) {
            return true;
        }
        
        const lastCheckDate = new Date(lastCheck);
        const now = new Date();
        const hoursSinceLastCheck = (now.getTime() - lastCheckDate.getTime()) / (1000 * 60 * 60);
        
        // Check once per day (24 hours)
        return hoursSinceLastCheck >= 24;
    }

    /**
     * Marks that we've checked for image updates today.
     */
    private async markImageUpdateChecked(): Promise<void> {
        const lastCheckKey = 'neonLocal.lastImageUpdateCheck';
        await this.context.globalState.update(lastCheckKey, new Date().toISOString());
    }

    /**
     * Checks if a newer version of the image is available on Docker Hub.
     * Returns true if an update is available.
     */
    private async isImageUpdateAvailable(): Promise<boolean> {
        try {
            const imageName = 'neondatabase/neon_local:v1';
            
            // Get local image digest
            let localDigest: string | undefined;
            try {
                const localImage = await this.docker.getImage(imageName).inspect();
                localDigest = localImage.RepoDigests?.[0];
                console.debug('Local image digest:', localDigest);
            } catch (error) {
                // Image doesn't exist locally, so we need to pull it
                console.debug('Local image not found, update required');
                return true;
            }

            // Get remote image digest using Docker registry API
            const authConfig = this.getDockerAuthConfig();
            const pullOpts = authConfig ? { authconfig: authConfig } : {};
            
            return new Promise((resolve, reject) => {
                // Use Docker's inspect to get the latest manifest
                this.docker.pull(imageName, pullOpts, (err: any, stream: any) => {
                    if (err) {
                        console.error('Failed to check for image updates:', err);
                        resolve(false); // Don't block on update check failures
                        return;
                    }

                    // Collect all progress events
                    const progressEvents: any[] = [];
                    this.docker.modem.followProgress(
                        stream,
                        (err: any) => {
                            if (err) {
                                console.error('Failed to check for image updates:', err);
                                resolve(false);
                                return;
                            }
                            
                            // Check if the pulled image has a different digest
                            this.docker.getImage(imageName).inspect()
                                .then((newImage: any) => {
                                    const newDigest = newImage.RepoDigests?.[0];
                                    console.debug('Remote image digest:', newDigest);
                                    
                                    // Compare digests - if different, an update was pulled
                                    const wasUpdated = localDigest !== newDigest;
                                    console.debug('Image update available:', wasUpdated);
                                    resolve(wasUpdated);
                                })
                                .catch(() => {
                                    resolve(false);
                                });
                        },
                        (event: any) => {
                            progressEvents.push(event);
                        }
                    );
                });
            });
        } catch (error) {
            console.error('Error checking for image updates:', error);
            return false;
        }
    }

    private async pullImage(checkForUpdates: boolean = false): Promise<void> {
        const imageName = 'neondatabase/neon_local:v1';
        
        try {
            await this.docker.getImage(imageName).inspect();
            
            // If image exists and we should check for updates
            if (checkForUpdates && await this.shouldCheckForImageUpdate()) {
                console.debug('Checking for proxy container image updates...');
                
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: "Checking for proxy container updates...",
                    cancellable: false
                }, async () => {
                    const updateAvailable = await this.isImageUpdateAvailable();
                    
                    if (updateAvailable) {
                        console.debug('New proxy container version available, updated successfully');
                        vscode.window.showInformationMessage('Proxy container updated to latest version');
                    } else {
                        console.debug('Proxy container is up to date');
                    }
                    
                    await this.markImageUpdateChecked();
                });
                
                return; // Image was already pulled during the update check
            }
        } catch {
            // Image doesn't exist, pull it
            const authConfig = this.getDockerAuthConfig();
            const pullOpts = authConfig ? { authconfig: authConfig } : {};

            await new Promise((resolve, reject) => {
                this.docker.pull(imageName, pullOpts, (err: any, stream: any) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    this.docker.modem.followProgress(stream, (err: any) => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve(true);
                    });
                });
            });
        }
    }

    public async checkBranchesFile(context: vscode.ExtensionContext): Promise<string | false> {
        try {
            const neonLocalPath = path.join(context.globalStorageUri.fsPath, '.neon_local');
            const branchesPath = path.join(neonLocalPath, '.branches');
            
            console.debug('🔍 Checking .branches file at:', branchesPath);
            
            if (!fs.existsSync(branchesPath)) {
                console.debug('⚠️  .branches file does not exist yet');
                return false;
            }
            
            const content = await fs.promises.readFile(branchesPath, 'utf-8');
            console.debug('📄 Raw .branches file content:', content);
            
            if (!content.trim()) {
                console.debug('⚠️  .branches file is empty');
                return false;
            }
            
            const data = JSON.parse(content);
            console.debug('📊 Parsed .branches file data:', JSON.stringify(data, null, 2));
            
            if (!data || Object.keys(data).length === 0) {
                console.debug('⚠️  No data in branches file');
                return false;
            }
            
            // Find the first key that has a branch_id
            const branchKey = Object.keys(data).find(key => 
                data[key] && typeof data[key] === 'object' && 'branch_id' in data[key]
            );
            
            if (!branchKey) {
                console.debug('❌ No branch ID found in branches file. Data structure:', JSON.stringify(data));
                return false;
            }
            
            const branchId = data[branchKey].branch_id;
            console.debug('✅ Found branch ID in .branches file:', branchId, 'from key:', branchKey);
            
            // Update the state with the branch ID from the .branches file
            await this.stateService.setCurrentlyConnectedBranch(branchId);
            
            return branchId;
        } catch (error) {
            console.error('❌ Error checking branches file:', error);
            return false;
        }
    }

    public async waitForBranchesFile(context: vscode.ExtensionContext): Promise<string | false> {
        const maxAttempts = 30; // 30 attempts, 1 second apart = 30 seconds timeout
        let attempts = 0;
        
        console.debug('🔍 Starting to wait for .branches file to be populated...');
        
        while (attempts < maxAttempts) {
            console.debug(`📊 Attempt ${attempts + 1}/${maxAttempts} to check .branches file`);
            
            const branchId = await this.checkBranchesFile(context);
            if (branchId) {
                console.debug(`✅ .branches file populated after ${attempts + 1} attempts with branch ID:`, branchId);
                return branchId;
            }
            
            attempts++;
            if (attempts < maxAttempts) {
                console.debug(`⏳ .branches file not ready, waiting 1 second before retry...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        console.error('❌ .branches file was not populated within timeout period');
        return false;
    }

    private async waitForContainer(): Promise<void> {
        const maxAttempts = 30; // 30 seconds timeout
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            try {
                const container = await this.docker.getContainer(this.containerName);
                const containerInfo = await container.inspect();
                
                if (containerInfo.State.Running) {
                    console.debug('Container is running, checking logs for readiness...');
                    // Container is running, now wait for the .branches file to be populated
                    const logs = await container.logs({
                        stdout: true,
                        stderr: true,
                        tail: 50
                    });
                    
                    const logStr = logs.toString();
                    
                    // Check for specific branch limit error (422 Unprocessable Entity)
                    if (logStr.includes('422 Client Error: Unprocessable Entity for url:') && logStr.includes('/branches')) {
                        console.error('Found branch limit error in container logs:', logStr);
                        throw new Error('Unable to create ephemeral branch, as you have reached your Branch limit. Delete one or more branches in the selected project and retry.');
                    }
                    
                    // Check if there are any other error messages in the logs
                    if (logStr.includes('Error:') || logStr.includes('error:')) {
                        console.error('Found error in container logs:', logStr);
                        throw new Error('Container reported an error in logs');
                    }
                    
                    // Check if the logs indicate the container is ready
                    if (logStr.includes('Neon Local is ready')) {
                        console.debug('Container is ready');
                        return;
                    } else {
                        console.debug('Container not yet ready, waiting for ready message...');
                    }
                }
                
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error('Error waiting for container:', error);
                
                // Re-throw specific branch limit error immediately
                if (error instanceof Error && error.message.includes('Unable to create ephemeral branch, as you have reached your Branch limit')) {
                    throw error;
                }
                
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        throw new Error('Container failed to become ready within timeout period');
    }

    async checkContainerReady(): Promise<boolean> {
        try {
            const container = await this.docker.getContainer(this.containerName);
            const logs = await container.logs({
                stdout: true,
                stderr: true,
                tail: 100
            });
            
            const logStr = logs.toString();
            console.debug('Checking container readiness, logs:', logStr);
            
            // Check if the ready message is present
            if (logStr.includes('Neon Local is ready')) {
                console.debug('Container is ready');
                return true;
            }
            
            console.debug('Container is not ready - no ready message found');
            return false;
        } catch (error) {
            console.error('Error checking container readiness:', error);
            return false;
        }
    }

    async getContainerInfo(): Promise<{
        branchId: string;
        projectId: string;
        driver: string;
        isParentBranch: boolean;
    } | null> {
        try {
            console.debug('🔍 Getting container info for:', this.containerName);
            const container = await this.docker.getContainer(this.containerName);
            const containerInfo = await container.inspect();
            
            // Extract environment variables
            const envVars = containerInfo.Config.Env;
            console.debug('📊 Container environment variables:', envVars);
            
            const getEnvValue = (key: string) => {
                const envVar = envVars.find((env: string) => env.startsWith(`${key}=`));
                return envVar ? envVar.split('=')[1] : '';
            };
            
            // Get branch ID (either from BRANCH_ID or PARENT_BRANCH_ID)
            const branchId = getEnvValue('BRANCH_ID') || getEnvValue('PARENT_BRANCH_ID');
            const projectId = getEnvValue('NEON_PROJECT_ID');
            const driver = getEnvValue('DRIVER');
            const isParentBranch = Boolean(getEnvValue('PARENT_BRANCH_ID'));
            
            console.debug('🔍 Extracted container info:', {
                branchId,
                projectId,
                driver,
                isParentBranch,
                fromBranchId: getEnvValue('BRANCH_ID'),
                fromParentBranchId: getEnvValue('PARENT_BRANCH_ID')
            });
            
            if (!branchId || !projectId) {
                console.error('❌ Missing required environment variables in container. branchId:', branchId, 'projectId:', projectId);
                return null;
            }
            
            return {
                branchId,
                projectId,
                driver: driver || 'postgres',
                isParentBranch
            };
        } catch (error) {
            console.error('❌ Error getting container info:', error);
            return null;
        }
    }

    private async startProxy(options: {
        branchId: string;
        driver: string;
        isExisting: boolean;
        context: vscode.ExtensionContext;
        projectId: string;
        port: number;
    }): Promise<void> {
        // Get API key from secure storage
        const persistentApiToken = await ConfigurationManager.getSecureToken(options.context, 'persistentApiToken');
        const apiKey = await ConfigurationManager.getSecureToken(options.context, 'apiKey');

        // If persistent token exists, use it for all operations
        if (persistentApiToken) {
            // Pull the latest image and check for updates once per day
            await this.pullImage(true);

            // Create container configuration
            const containerConfig: any = {
                Image: 'neondatabase/neon_local:v1',
                name: this.containerName,
                StopTimeout: 20, // 20 second grace period for manual stops
                Env: [
                    `DRIVER=${options.driver === 'serverless' ? 'serverless' : 'postgres'}`,
                    `NEON_API_KEY=${persistentApiToken}`,
                    `NEON_PROJECT_ID=${options.projectId}`,
                    'CLIENT=vscode',
                    options.isExisting ? `BRANCH_ID=${options.branchId}` : `PARENT_BRANCH_ID=${options.branchId}`
                ],
                HostConfig: {
                    PortBindings: {
                        '5432/tcp': [{ HostPort: options.port.toString() }]
                    }
                }
            };

            // Add volume binding using global storage path
            const neonLocalPath = path.join(options.context.globalStorageUri.fsPath, '.neon_local');
            containerConfig.HostConfig.Binds = [`${neonLocalPath}:/tmp/.neon_local`];

            await this.startContainerInternal(containerConfig);
            return;
        }

        // For new branches, require persistent token
        if (!options.isExisting) {
            throw new Error('Persistent API token required for creating new branches.');
        }

        // For existing branches, require OAuth token
        if (!apiKey) {
            throw new Error('Authentication required. Please sign in.');
        }

        // Refresh token if needed before starting container
        const authManager = AuthManager.getInstance(options.context);
        // Only refresh if access token is close to expiry; avoid forcing immediately after a
        // successful silent refresh during extension startup which would invalidate the just-issued
        // refresh token and cause an "invalid_grant" error.
        const refreshSuccess = await authManager.refreshTokenIfNeeded();
        if (!refreshSuccess) {
            console.debug('DockerService: Token refresh failed – signing user out.');
            await authManager.signOut();
            throw new Error('Failed to refresh authentication token. Please sign in again.');
        }

        // Get the potentially refreshed token
        const refreshedApiKey = await ConfigurationManager.getSecureToken(options.context, 'apiKey');
        if (!refreshedApiKey) {
            throw new Error('No valid authentication token available. Please sign in again.');
        }

        // Pull the latest image and check for updates once per day
        await this.pullImage(true);

        // Create container configuration
        const containerConfig: any = {
            Image: 'neondatabase/neon_local:v1',
            name: this.containerName,
            StopTimeout: 20, // 20 second grace period for manual stops
            Env: [
                `DRIVER=${options.driver === 'serverless' ? 'serverless' : 'postgres'}`,
                `NEON_API_KEY=${refreshedApiKey}`,
                `NEON_PROJECT_ID=${options.projectId}`,
                'CLIENT=vscode',
                `BRANCH_ID=${options.branchId}`
            ],
            HostConfig: {
                PortBindings: {
                    '5432/tcp': [{ HostPort: options.port.toString() }]
                }
            }
        };

        // Add volume binding using global storage path
        const neonLocalPath = path.join(options.context.globalStorageUri.fsPath, '.neon_local');
        containerConfig.HostConfig.Binds = [`${neonLocalPath}:/tmp/.neon_local`];

        await this.startContainerInternal(containerConfig);
    }

    private async startContainerInternal(containerConfig: any): Promise<void> {
        const containerName = containerConfig.name;

        // Try to find and remove existing container
        try {
            const containers = await this.docker.listContainers({ all: true });
            const existing = containers.find(c => c.Names.includes(`/${containerName}`));

            if (existing) {
                const oldContainer = this.docker.getContainer(existing.Id);
                try {
                    await oldContainer.stop({ t: 20 }); // 20 second grace period
                } catch (_) {
                    // ignore
                }
                await oldContainer.remove({ force: true });
                console.debug(`Removed existing container: ${containerName}`);
                
                // Delete the .branches file when removing existing container
                await this.fileService.deleteBranchesFile();
            }
        } catch (err) {
            console.error('Error checking for existing container:', err);
        }

        // Create and start new container
        const container = await this.docker.createContainer(containerConfig);
        await container.start();
        console.debug(`Started new container: ${containerName}`);

        // Set the connection string based on the driver
        const connectionString = `postgres://neon:npg@localhost:${containerConfig.HostConfig.PortBindings['5432/tcp'][0].HostPort}/<database_name>`;
        await this.stateService.setConnectionInfo({
            connectionInfo: connectionString,
            selectedDatabase: ''
        });
        
        // Start periodic status check
        await this.startStatusCheck();
    }
} 