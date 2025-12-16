import * as vscode from 'vscode';
import { NeonBranch, NeonOrg, NeonProject, NeonDatabase, NeonRole } from '../types';
import { AuthManager } from '../auth/authManager';
import * as https from 'https';

interface NetworkError extends Error {
    code?: string;
}

interface NeonEndpoint {
  host: string;
  id: string;
  project_id: string;
  branch_id: string;
  type: string;
  current_state: string;
  pooler_enabled: boolean;
  pooler_mode: string;
  disabled: boolean;
  passwordless_access: boolean;
  last_active: string;
  creation_source: string;
  created_at: string;
  updated_at: string;
  suspended_at: string;
  proxy_host: string;
  suspend_timeout_seconds: number;
  provisioner: string;
}

interface EndpointsResponse {
  endpoints: NeonEndpoint[];
}

export class NeonApiService {
    private readonly authManager: AuthManager;
    private readonly baseUrl = 'console.neon.tech';

    constructor(context: vscode.ExtensionContext) {
        this.authManager = AuthManager.getInstance(context);
    }

    // Validation method that doesn't use auto-refresh to avoid infinite loops
    public async validateToken(token: string): Promise<boolean> {
        console.debug('🔍 Validating token with direct API call (no auto-refresh)...');
        
        return new Promise((resolve) => {
            const options: https.RequestOptions = {
                hostname: 'console.neon.tech',
                path: '/api/v2/users/me/organizations',
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    console.debug(`📡 Validation response: ${res.statusCode}`);
                    
                    if (res.statusCode === 200) {
                        console.debug('✅ Token validation successful');
                        resolve(true);
                    } else {
                        console.debug(`❌ Token validation failed with status ${res.statusCode}: ${responseData}`);
                        resolve(false);
                    }
                });
            });

            req.on('error', (error) => {
                console.debug(`❌ Token validation failed with error: ${error.message}`);
                resolve(false);
            });

            req.end();
        });
    }

    private async getToken(): Promise<string | null> {
        const persistentApiToken = await this.authManager.getPersistentApiToken();
        const apiKey = this.authManager.tokenSet?.access_token;
        
        if (!persistentApiToken && !apiKey) {
            throw new Error('Authentication required. Please sign in.');
        }

        return persistentApiToken || apiKey || null;
    }

    // The `attempt` parameter tracks how many times we have retried the same request after a 401.
    // 0 = first attempt, 1 = after one refresh attempt. We sign the user out if a second 401 is
    // encountered because either (a) their persistent API token was revoked or (b) refreshing the
    // OAuth token did not yield valid credentials. This prevents infinite retry loops.
    private async makeRequest<T>(path: string, method: string = 'GET', data?: any, attempt: number = 0): Promise<T> {
        try {
            console.debug(`makeRequest: Starting request to ${path} (attempt ${attempt})`);
            const token = await this.getToken();
            console.debug('makeRequest: Token retrieved', { hasToken: !!token, tokenLength: token?.length });
            if (!token) {
                throw new Error('No authentication token available');
            }

            const options: https.RequestOptions = {
                hostname: 'console.neon.tech',
                path: `/api/v2${path}`,
                method: method,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            };

            console.debug('Making request:', {
                method,
                path: `/api/v2${path}`,
                hostname: options.hostname,
                hasToken: !!token,
                tokenLength: token?.length,
                data
            });

            return new Promise((resolve, reject) => {
                const req = https.request(options, async (res) => {
                    console.debug('Response started:', {
                        statusCode: res.statusCode,
                        headers: res.headers
                    });
                    let responseData = '';
                    res.on('data', (chunk) => {
                        responseData += chunk;
                    });

                    res.on('end', async () => {
                        console.debug('Response received:', {
                            statusCode: res.statusCode,
                            headers: res.headers,
                            data: responseData
                        });

                        if (res.statusCode === 401) {
                            // If the user is currently relying on a persistent API token we cannot
                            // refresh it – the only remedy is to sign them out so they can provide
                            // a new token or re-authenticate.
                            const persistentApiToken = await this.authManager.getPersistentApiToken();
                            if (persistentApiToken) {
                                console.debug('401 received while using persistent API token – signing out.');
                                await this.authManager.signOut();
                                reject(new Error('Session expired. Please sign in again.'));
                                return;
                            }

                            // For OAuth flows, allow a single refresh+retry cycle. If we already
                            // refreshed once (attempt >= 1) and still receive 401, sign the user out
                            // to avoid an infinite loop.
                            if (attempt >= 1) {
                                console.debug('Received 401 after token refresh – signing out to prevent loop.');
                                await this.authManager.signOut();
                                reject(new Error('Session expired. Please sign in again.'));
                                return;
                            }

                            try {
                                console.debug('Token expired, attempting refresh...');
                                const success = await this.authManager.refreshTokenIfNeeded(true);
                                
                                if (!success) {
                                    await this.authManager.signOut();
                                    reject(new Error('Session expired. Please sign in again.'));
                                    return;
                                }

                                const newToken = await this.getToken();
                                if (!newToken) {
                                    await this.authManager.signOut();
                                    reject(new Error('Session expired. Please sign in again.'));
                                    return;
                                }

                                // Retry the request once with the refreshed token. We increment the
                                // `attempt` counter so that any subsequent 401 will trigger logout.
                                try {
                                    const result = await this.makeRequest<T>(path, method, data, attempt + 1);
                                    resolve(result);
                                } catch (error) {
                                    reject(error);
                                }
                            } catch (refreshError) {
                                console.error('Token refresh failed:', refreshError);
                                await this.authManager.signOut();
                                reject(new Error('Session expired. Please sign in again.'));
                            }
                            return;
                        }

                        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                const parsedData = responseData ? JSON.parse(responseData) : null;
                                resolve(parsedData as T);
                            } catch (error) {
                                reject(new Error(`Failed to parse response: ${error instanceof Error ? error.message : 'Unknown error'}`));
                            }
                        } else {
                            reject(new Error(`Request failed with status ${res.statusCode}: ${responseData}`));
                        }
                    });
                });

                req.on('error', (error) => {
                    console.error('Request error:', error);
                    reject(new Error(`Request failed: ${error.message}`));
                });

                // Set a timeout of 30 seconds for the request
                req.setTimeout(30000, () => {
                    console.error('Request timeout after 30 seconds');
                    req.destroy();
                    reject(new Error('Request timeout after 30 seconds'));
                });

                if (data) {
                    const jsonData = JSON.stringify(data);
                    console.debug('Sending request body:', jsonData);
                    req.write(jsonData);
                }
                req.end();
            });
        } catch (error) {
            console.error('Error in makeRequest:', error);
            throw error;
        }
    }

    public async getOrgs(): Promise<NeonOrg[]> {
        try {
            console.debug('Fetching organizations...');
            const response = await this.makeRequest<any>('/users/me/organizations');
            console.debug('Raw organizations response:', JSON.stringify(response, null, 2));

            // Ensure we return an array of organizations
            const orgs = Array.isArray(response) ? response : response.organizations || [];
            console.debug('Organizations:', orgs.length);
            
            return orgs;
        } catch (error: unknown) {
            console.error('Error fetching organizations:', error);
            throw new Error(`Failed to fetch organizations: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getProjects(orgId: string): Promise<NeonProject[]> {
        if (!orgId) {
            console.warn('getProjects called without orgId');
            return [];
        }
        
        console.debug(`Fetching projects for orgId: ${orgId}`);
        let retryCount = 0;
        const maxRetries = 3;
        const retryDelay = 1000;

        while (retryCount < maxRetries) {
            try {
                const path = `/projects?org_id=${orgId}`;
                console.debug(`Fetching projects from path: ${path}`);
                
                const response = await this.makeRequest<any>(path);
                console.debug('Raw API response:', response);

                // Handle different response formats
                let projects: NeonProject[] = [];
                if (Array.isArray(response)) {
                    projects = response;
                } else if (response.projects && Array.isArray(response.projects)) {
                    projects = response.projects;
                } else if (response.project) {
                    projects = [response.project];
                } else if (typeof response === 'object' && !Array.isArray(response)) {
                    projects = [response];
                }

                console.debug('Processed projects:', projects);
                return projects;
            } catch (error) {
                retryCount++;
                console.debug(`Attempt ${retryCount} failed: ${error}`);
                
                if (retryCount === maxRetries) {
                    throw new Error(`Failed to fetch projects: ${error}`);
                }
                
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        throw new Error('Failed to fetch projects after maximum retries');
    }

    public async getBranches(projectId: string): Promise<NeonBranch[]> {
        try {
            console.debug(`🔍 API Request - getBranches: projectId="${projectId}"`);
            console.debug(`📡 Making API request to: /projects/${projectId}/branches`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches`);
            console.debug(`✅ getBranches response:`, response);
            
            // Ensure we return an array of branches
            const branches = Array.isArray(response) ? response : response.branches || [];
            console.debug(`🌿 Processed branches (${branches.length} items):`, branches.map((b: any) => ({ id: b.id, name: b.name })));
            
            return branches;
        } catch (error: unknown) {
            console.error(`❌ Error fetching branches for project="${projectId}":`, error);
            throw new Error(`Failed to fetch branches: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getEndpointInfo(endpointId: string): Promise<{ project_id: string; branch_id: string; id: string } | null> {
        try {
            console.debug(`🔍 API Request - getEndpointInfo: endpointId="${endpointId}"`);
            
            // The endpoint ID format is typically ep-xxx-xxx, we need to find which project it belongs to
            // Unfortunately, there's no direct API to look up an endpoint by ID without knowing the project
            // So we need to search through projects
            const orgs = await this.getOrgs();
            
            for (const org of orgs) {
                const projects = await this.getProjects(org.id);
                
                for (const project of projects) {
                    try {
                        // Get endpoints for this project
                        const response = await this.makeRequest<any>(`/projects/${project.id}/endpoints`);
                        const endpoints = Array.isArray(response) ? response : response.endpoints || [];
                        
                        const endpoint = endpoints.find((ep: any) => ep.id === endpointId);
                        if (endpoint) {
                            console.debug(`✅ Found endpoint:`, endpoint);
                            return {
                                id: endpoint.id,
                                project_id: endpoint.project_id || project.id,
                                branch_id: endpoint.branch_id
                            };
                        }
                    } catch (error) {
                        // Continue searching other projects
                        console.debug(`No endpoint found in project ${project.id}`);
                    }
                }
            }
            
            console.warn(`❌ Endpoint ${endpointId} not found in any project`);
            return null;
        } catch (error: unknown) {
            console.error(`❌ Error fetching endpoint info for "${endpointId}":`, error);
            return null;
        }
    }

    public async getProject(projectId: string): Promise<{ id: string; name: string; org_id?: string } | null> {
        try {
            console.debug(`🔍 API Request - getProject: projectId="${projectId}"`);
            console.debug(`📡 Making API request to: /projects/${projectId}`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}`);
            console.debug(`✅ getProject response:`, response);
            
            const project = response.project || response;
            return {
                id: project.id,
                name: project.name,
                org_id: project.org_id
            };
        } catch (error: unknown) {
            console.error(`❌ Error fetching project "${projectId}":`, error);
            return null;
        }
    }

    public async getBranch(projectId: string, branchId: string): Promise<{ id: string; name: string } | null> {
        try {
            console.debug(`🔍 API Request - getBranch: projectId="${projectId}", branchId="${branchId}"`);
            console.debug(`📡 Making API request to: /projects/${projectId}/branches/${branchId}`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches/${branchId}`);
            console.debug(`✅ getBranch response:`, response);
            
            const branch = response.branch || response;
            return {
                id: branch.id,
                name: branch.name
            };
        } catch (error: unknown) {
            console.error(`❌ Error fetching branch for project="${projectId}", branch="${branchId}":`, error);
            return null;
        }
    }

    public async getDatabases(projectId: string, branchId: string): Promise<NeonDatabase[]> {
        try {
            console.debug(`🔍 API Request - getDatabases: projectId="${projectId}", branchId="${branchId}"`);
            console.debug(`📡 Making API request to: /projects/${projectId}/branches/${branchId}/databases`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches/${branchId}/databases`);
            console.debug(`✅ getDatabases response:`, response);
            
            // Ensure we return an array of databases
            const databases = Array.isArray(response) ? response : response.databases || [];
            console.debug(`📊 Processed databases (${databases.length} items):`, databases);
            
            return databases;
        } catch (error: unknown) {
            console.error(`❌ Error fetching databases for project="${projectId}", branch="${branchId}":`, error);
            throw new Error(`Failed to fetch databases: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async createDatabase(
        projectId: string, 
        branchId: string, 
        name: string, 
        ownerName?: string
    ): Promise<NeonDatabase> {
        try {
            console.debug(`🔍 API Request - createDatabase: projectId="${projectId}", branchId="${branchId}", name="${name}", ownerName="${ownerName}"`);
            
            const requestBody: any = {
                database: {
                    name: name
                }
            };
            
            if (ownerName) {
                requestBody.database.owner_name = ownerName;
            }
            
            console.debug(`📡 Making API POST request to: /projects/${projectId}/branches/${branchId}/databases`, requestBody);
            
            const response = await this.makeRequest<any>(
                `/projects/${projectId}/branches/${branchId}/databases`,
                'POST',
                requestBody
            );
            
            console.debug(`✅ createDatabase response:`, response);
            
            // The API returns a database object
            const database = response.database || response;
            console.debug(`📊 Created database:`, database);
            
            return database;
        } catch (error: unknown) {
            console.error(`❌ Error creating database:`, error);
            throw new Error(`Failed to create database: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getRoles(projectId: string, branchId: string): Promise<NeonRole[]> {
        try {
            console.debug(`🔍 API Request - getRoles: projectId="${projectId}", branchId="${branchId}"`);
            console.debug(`📡 Making API request to: /projects/${projectId}/branches/${branchId}/roles`);
            
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches/${branchId}/roles`);
            console.debug(`✅ getRoles response:`, response);
            
            // Ensure we return an array of roles
            const roles = Array.isArray(response) ? response : response.roles || [];
            console.debug(`👥 Processed roles (${roles.length} items):`, roles);
            
            return roles;
        } catch (error: unknown) {
            console.error(`❌ Error fetching roles for project="${projectId}", branch="${branchId}":`, error);
            throw new Error(`Failed to fetch roles: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getRolePassword(projectId: string, branchId: string, roleName: string): Promise<string> {
        try {
            const response = await this.makeRequest<{ password: string }>(`/projects/${projectId}/branches/${branchId}/roles/${roleName}/reveal_password`);
            return response.password;
        } catch (error: unknown) {
            console.error('Error getting role password:', error);
            throw new Error(`Failed to get role password: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getBranchEndpoint(projectId: string, branchId: string): Promise<string> {
        try {
            const response = await this.makeRequest<EndpointsResponse>(`/projects/${projectId}/branches/${branchId}/endpoints`);
            console.debug('Branch endpoints response:', response);
            
            if (!response.endpoints || !Array.isArray(response.endpoints) || response.endpoints.length === 0) {
                console.error('No endpoints found in response:', response);
                throw new Error('No endpoints found for branch');
            }

            // Find the read_write endpoint
            const readWriteEndpoint = response.endpoints.find(endpoint => endpoint.type === 'read_write');
            if (!readWriteEndpoint) {
                console.error('No read_write endpoint found in response:', response.endpoints);
                throw new Error('No read_write endpoint found for branch');
            }

            const endpoint = readWriteEndpoint.host;
            if (!endpoint) {
                console.error('Endpoint host not found in response:', readWriteEndpoint);
                throw new Error('Endpoint host not found in response');
            }
            
            return endpoint;
        } catch (error: unknown) {
            console.error('Error getting branch endpoint:', error);
            throw new Error(`Failed to get branch endpoint: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async resetBranchToParent(projectId: string, branchId: string): Promise<void> {
        try {
            console.debug(`Resetting branch ${branchId} in project ${projectId} to parent state`);
            await this.makeRequest<void>(
                `/projects/${projectId}/branches/${branchId}/reset_to_parent`,
                'POST'
            );
        } catch (error: unknown) {
            console.error('Error resetting branch:', error);
            throw new Error(`Failed to reset branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getBranchDetails(projectId: string, branchId: string): Promise<{ parent_id: string | null }> {
        try {
            const response = await this.makeRequest<any>(`/projects/${projectId}/branches/${branchId}`);
            return {
                parent_id: response.branch?.parent_id || null
            };
        } catch (error: unknown) {
            console.error('Error fetching branch details:', error);
            throw new Error(`Failed to fetch branch details: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async createBranch(projectId: string, parentBranchId: string, branchName: string): Promise<NeonBranch> {
        try {
            const payload = {
                branch: {
                    name: branchName,
                    parent_id: parentBranchId
                },
                endpoints: [{
                    type: 'read_write',
                }],
                annotation_value: {
                    vscode: 'true'
                }
            };

            const response = await this.makeRequest<any>(`/projects/${projectId}/branches`, 'POST', payload);
            return response.branch;
        } catch (error: unknown) {
            console.error('Error creating branch:', error);
            throw new Error(`Failed to create branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async createRole(projectId: string, branchId: string, roleName: string): Promise<any> {
        try {
            const payload = {
                role: {
                    name: roleName
                }
            };

            const response = await this.makeRequest<any>(
                `/projects/${projectId}/branches/${branchId}/roles`, 
                'POST', 
                payload
            );
            return response;
        } catch (error: unknown) {
            console.error('Error creating role:', error);
            throw new Error(`Failed to create role: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async resetRolePassword(projectId: string, branchId: string, roleName: string): Promise<any> {
        try {
            const response = await this.makeRequest<any>(
                `/projects/${projectId}/branches/${branchId}/roles/${roleName}/reset_password`, 
                'POST',
                {}
            );
            return response;
        } catch (error: unknown) {
            console.error('Error resetting role password:', error);
            throw new Error(`Failed to reset role password: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async deleteRole(projectId: string, branchId: string, roleName: string): Promise<any> {
        try {
            const response = await this.makeRequest<any>(
                `/projects/${projectId}/branches/${branchId}/roles/${roleName}`, 
                'DELETE'
            );
            return response;
        } catch (error: unknown) {
            console.error('Error deleting role:', error);
            throw new Error(`Failed to delete role: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Creates a new API key for the authenticated user.
     * Returns the key which should be stored securely as it's only shown once.
     * @param keyName - A user-specified name for the API key
     * @returns Object containing the API key ID and the key itself
     */
    public async createApiKey(keyName: string): Promise<{ id: string; key: string }> {
        try {
            console.debug('Creating API key with name:', keyName);
            const payload = {
                key_name: keyName
            };

            const response = await this.makeRequest<any>('/api_keys', 'POST', payload);
            console.debug('API key creation response:', JSON.stringify(response, null, 2));
            
            // The response format from Neon API docs is typically nested
            // It could be { id, key } or { api_key: { id, key } } or similar
            let id: string;
            let key: string;
            
            if (response.id && response.key) {
                // Direct format
                id = response.id;
                key = response.key;
            } else if (response.api_key) {
                // Nested format
                id = response.api_key.id;
                key = response.api_key.key;
            } else {
                console.error('Unexpected API key response format:', response);
                throw new Error('Unexpected API response format');
            }
            
            console.debug('API key created successfully, ID:', id);
            return { id, key };
        } catch (error: unknown) {
            console.error('Error creating API key:', error);
            throw new Error(`Failed to create API key: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get complete connection information for all databases in a branch.
     * This includes host, database name, user (owner), and password for each database.
     * Similar to the Python `get_branch_connection_info` method.
     */
    public async getBranchConnectionInfo(projectId: string, branchId: string): Promise<Array<{
        host: string;
        database: string;
        user: string;
        password: string;
    }>> {
        try {
            console.debug(`Fetching connection info for project=${projectId}, branch=${branchId}`);
            
            // Get the endpoint host for the branch
            const host = await this.getBranchEndpoint(projectId, branchId);
            console.debug(`Endpoint host: ${host}`);
            
            // Get all databases in the branch
            const databases = await this.getDatabases(projectId, branchId);
            console.debug(`Found ${databases.length} databases`);
            
            if (!databases || databases.length === 0) {
                throw new Error('No databases found in the branch');
            }
            
            // For each database, get the owner's password and build connection info
            const connectionInfoPromises = databases.map(async (db) => {
                if (!db.name || !db.owner_name) {
                    console.warn(`Database ${db.name || 'unknown'} missing name or owner, skipping`);
                    return null;
                }
                
                try {
                    const password = await this.getRolePassword(projectId, branchId, db.owner_name);
                    return {
                        host,
                        database: db.name,
                        user: db.owner_name,
                        password
                    };
                } catch (error) {
                    console.error(`Failed to get password for ${db.owner_name}:`, error);
                    return null;
                }
            });
            
            const connectionInfos = await Promise.all(connectionInfoPromises);
            
            // Filter out any null values (databases that failed)
            const validConnectionInfos = connectionInfos.filter(info => info !== null) as Array<{
                host: string;
                database: string;
                user: string;
                password: string;
            }>;
            
            if (validConnectionInfos.length === 0) {
                throw new Error('Failed to get connection info for any database');
            }
            
            console.debug(`Successfully built connection info for ${validConnectionInfos.length} databases`);
            return validConnectionInfos;
            
        } catch (error: unknown) {
            console.error('Error getting branch connection info:', error);
            throw new Error(`Failed to get branch connection info: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}