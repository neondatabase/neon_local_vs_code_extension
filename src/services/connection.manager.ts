import { Client } from 'pg';
import * as vscode from 'vscode';
import { StateService } from './state.service';

export interface ConnectionConfig {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    ssl?: {
        rejectUnauthorized: boolean;
    };
}

export class ConnectionManager {
    private static instance: ConnectionManager;
    private client: Client | null = null;
    private currentDatabase: string | null = null;
    private isConnecting: boolean = false;
    private connectionPromise: Promise<Client> | null = null;
    private stateService: StateService;

    private constructor(stateService: StateService) {
        this.stateService = stateService;
    }

    public static getInstance(stateService: StateService): ConnectionManager {
        if (!ConnectionManager.instance) {
            ConnectionManager.instance = new ConnectionManager(stateService);
        }
        return ConnectionManager.instance;
    }

    private async getConnectionConfig(database?: string): Promise<ConnectionConfig> {
        const viewData = await this.stateService.getViewData();
        
        if (!viewData.connected) {
            throw new Error('Database is not connected. Please connect first.');
        }

        const branchConnectionInfos = viewData.connection.branchConnectionInfos;
        if (!branchConnectionInfos || branchConnectionInfos.length === 0) {
            throw new Error('No connection information available. Please reconnect.');
        }

        // Find connection info for the requested database
        const requestedDatabase = database || viewData.connection.selectedDatabase;
        let connectionInfo = branchConnectionInfos.find(info => info.database === requestedDatabase);
        
        // If not found, use the first available database from the branch
        if (!connectionInfo) {
            if (requestedDatabase) {
                console.debug(`Database "${requestedDatabase}" not found in branch, using first available database: "${branchConnectionInfos[0].database}"`);
            }
            connectionInfo = branchConnectionInfos[0];
        }

        // Always use the database from the connection info (only connect to databases that exist in the branch)
        const databaseToUse = connectionInfo.database;

        return {
            host: connectionInfo.host,
            port: 5432, // Neon always uses 5432
            database: databaseToUse,
            user: connectionInfo.user,
            password: connectionInfo.password,
            ssl: {
                rejectUnauthorized: false
            }
        };
    }

    private async createConnection(config: ConnectionConfig): Promise<Client> {
        const client = new Client(config);
        
        try {
            await client.connect();
            console.log(`Connected to database: ${config.database}`);
            return client;
        } catch (error) {
            console.error('Failed to connect to database:', error);
            throw new Error(`Unable to connect to database ${config.database}. ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    public async getConnection(database?: string): Promise<Client> {
        // Get the target database, falling back to the first available database from connection info
        const viewData = await this.stateService.getViewData();
        const branchConnectionInfos = viewData.connection.branchConnectionInfos;
        const firstAvailableDatabase = branchConnectionInfos && branchConnectionInfos.length > 0 
            ? branchConnectionInfos[0].database 
            : 'neondb';
        const targetDatabase = database || viewData.selectedDatabase || firstAvailableDatabase;

        // If we have a connection to the same database, return it
        if (this.client && this.currentDatabase === targetDatabase) {
            try {
                // Test the connection with a simple query
                await this.client.query('SELECT 1');
                return this.client;
            } catch (error) {
                console.warn('Existing connection failed, creating new one:', error);
                // Connection is dead, clean up
                await this.disconnect();
            }
        }

        // If we're already connecting, wait for that connection
        if (this.isConnecting && this.connectionPromise) {
            return await this.connectionPromise;
        }

        // Create new connection
        this.isConnecting = true;
        this.connectionPromise = this.createNewConnection(targetDatabase);

        try {
            const client = await this.connectionPromise;
            this.client = client;
            this.currentDatabase = targetDatabase;
            this.isConnecting = false;
            this.connectionPromise = null;
            return client;
        } catch (error) {
            this.isConnecting = false;
            this.connectionPromise = null;
            throw error;
        }
    }

    private async createNewConnection(database: string): Promise<Client> {
        // Close existing connection if it's to a different database
        if (this.client && this.currentDatabase !== database) {
            await this.disconnect();
        }

        const config = await this.getConnectionConfig(database);
        return await this.createConnection(config);
    }

    public async executeQuery<T = any>(
        query: string,
        params: any[] = [],
        database?: string
    ): Promise<{ rows: T[]; rowCount: number }> {
        const client = await this.getConnection(database);

        try {
            const result = await client.query(query, params);
            return {
                rows: result.rows,
                rowCount: result.rowCount || 0
            };
        } catch (error) {
            console.error('Query execution failed:', error);

            // If the error indicates a connection issue, clean up and retry once
            if (this.isConnectionError(error)) {
                console.log('Connection error detected, retrying with new connection...');
                await this.disconnect();

                const newClient = await this.getConnection(database);
                const retryResult = await newClient.query(query, params);
                return {
                    rows: retryResult.rows,
                    rowCount: retryResult.rowCount || 0
                };
            }

            throw error;
        }
    }

    private isConnectionError(error: any): boolean {
        const connectionErrorCodes = [
            'ECONNRESET',
            'ECONNREFUSED',
            'ENOTFOUND',
            'ETIMEDOUT',
            'CONNECTION_TERMINATED'
        ];

        return connectionErrorCodes.some(code =>
            error.code === code ||
            error.message?.includes(code) ||
            error.message?.includes('connection')
        );
    }

    public async testConnection(database?: string): Promise<boolean> {
        try {
            const client = await this.getConnection(database);
            await client.query('SELECT 1');
            return true;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }

    public async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.end();
                console.log('Disconnected from database');
            } catch (error) {
                console.warn('Error during disconnect:', error);
            } finally {
                this.client = null;
                this.currentDatabase = null;
            }
        }
    }

    public getCurrentDatabase(): string | null {
        return this.currentDatabase;
    }

    public isConnected(): boolean {
        return this.client !== null;
    }

    // Cleanup method for extension deactivation
    public async cleanup(): Promise<void> {
        await this.disconnect();
        ConnectionManager.instance = null as any;
    }
}