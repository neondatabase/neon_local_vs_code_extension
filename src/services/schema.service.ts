import * as vscode from 'vscode';
import { Client } from 'pg';
import { StateService } from './state.service';
import { ConnectionPoolService, ManagedClient } from './connectionPool.service';

export interface SchemaItem {
    id: string;
    name: string;
    type: 'connection' | 'database' | 'schema' | 'table' | 'view' | 'column' | 'index' | 'function' | 'trigger';
    parent?: string;
    children?: SchemaItem[];
    metadata?: any;
}

export interface TableColumn {
    column_name: string;
    data_type: string;
    is_nullable: boolean;
    column_default: string | null;
    character_maximum_length: number | null;
    is_primary_key: boolean;
    is_foreign_key: boolean;
    foreign_table?: string;
    foreign_column?: string;
}

export interface TableInfo {
    table_name: string;
    table_schema: string;
    table_type: 'BASE TABLE' | 'VIEW' | 'MATERIALIZED VIEW';
    row_count?: number;
}

export interface IndexInfo {
    index_name: string;
    table_name: string;
    column_names: string[];
    is_unique: boolean;
    is_primary: boolean;
}

export interface FunctionInfo {
    function_name: string;
    schema_name: string;
    return_type: string;
    argument_types: string[];
}

export class SchemaService {
    private connectionPool: ConnectionPoolService;

    constructor(
        private stateService: StateService,
        private context: vscode.ExtensionContext
    ) {
        this.connectionPool = new ConnectionPoolService(stateService);
    }

    private async getConnection(database?: string): Promise<ManagedClient> {
        return await this.connectionPool.getConnection(database);
    }

    async getDatabases(): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    datname as name,
                    pg_size_pretty(pg_database_size(datname)) as size
                FROM pg_database 
                WHERE datistemplate = false 
                    AND datname NOT IN ('postgres', 'template0', 'template1')
                ORDER BY datname
            `, [], 'postgres'); // Connect to postgres database to list all databases

            return result.rows.map((row, index) => ({
                id: `db_${row.name}`,
                name: row.name,
                type: 'database' as const,
                metadata: {
                    size: row.size
                }
            }));
        } catch (error) {
            console.error('Error fetching databases:', error);
            // Provide a more user-friendly error message
            if (error instanceof Error && error.message.includes('AggregateError')) {
                throw new Error('Unable to connect to the database proxy. Please ensure the Neon proxy container is running and accessible.');
            }
            throw error;
        }
    }

    async getSchemas(database: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    schema_name as name
                FROM information_schema.schemata 
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'pg_toast_temp_1')
                ORDER BY schema_name
            `, [], database);

            return result.rows.map((row) => ({
                id: `schema_${database}_${row.name}`,
                name: row.name,
                type: 'schema' as const,
                parent: `db_${database}`,
                metadata: {}
            }));
        } catch (error) {
            console.error('Error fetching schemas:', error);
            throw error;
        }
    }

    async getTables(database: string, schema: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    table_name as name,
                    table_type
                FROM information_schema.tables 
                WHERE table_schema = $1
                    AND table_type IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
                ORDER BY table_type, table_name
            `, [schema], database);

            return result.rows.map((row) => ({
                id: `table_${database}_${schema}_${row.name}`,
                name: row.name,
                type: row.table_type === 'VIEW' || row.table_type === 'MATERIALIZED VIEW' ? 'view' : 'table' as const,
                parent: `schema_${database}_${schema}`,
                metadata: {
                    table_type: row.table_type
                }
            }));
        } catch (error) {
            console.error('Error fetching tables:', error);
            throw error;
        }
    }

    async getColumns(database: string, schema: string, table: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    c.column_name as name,
                    c.data_type,
                    c.is_nullable,
                    c.column_default,
                    c.character_maximum_length,
                    CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
                    CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key,
                    fk.foreign_table_name,
                    fk.foreign_column_name
                FROM information_schema.columns c
                LEFT JOIN (
                    SELECT ku.column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                    WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
                ) pk ON c.column_name = pk.column_name
                LEFT JOIN (
                    SELECT 
                        ku.column_name,
                        ccu.table_name AS foreign_table_name,
                        ccu.column_name AS foreign_column_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                    JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
                    WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
                ) fk ON c.column_name = fk.column_name
                WHERE c.table_schema = $1 AND c.table_name = $2
                ORDER BY c.ordinal_position
            `, [schema, table], database);

            return result.rows.map((row) => ({
                id: `column_${database}_${schema}_${table}_${row.name}`,
                name: row.name,
                type: 'column' as const,
                parent: `table_${database}_${schema}_${table}`,
                metadata: {
                    data_type: row.data_type,
                    is_nullable: row.is_nullable === 'YES',
                    column_default: row.column_default,
                    character_maximum_length: row.character_maximum_length,
                    is_primary_key: row.is_primary_key,
                    is_foreign_key: row.is_foreign_key,
                    foreign_table: row.foreign_table_name,
                    foreign_column: row.foreign_column_name
                }
            }));
        } catch (error) {
            console.error('Error fetching columns:', error);
            throw error;
        }
    }

    async getAllSchemaItems(database: string): Promise<SchemaItem[]> {
        let client: ManagedClient | null = null;
        
        try {
            client = await this.getConnection(database);

            // Get all tables and views
            const tablesResult = await client.query(`
                SELECT 
                    schemaname as schema_name,
                    tablename as table_name,
                    'table' as table_type
                FROM pg_tables 
                WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
                UNION ALL
                SELECT 
                    schemaname as schema_name,
                    viewname as table_name,
                    'view' as table_type
                FROM pg_views 
                WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
                ORDER BY schema_name, table_name
            `);

            const items: SchemaItem[] = [];

            // Add tables and views
            for (const row of tablesResult.rows) {
                const tableId = `table_${database}_${row.schema_name}_${row.table_name}`;
                items.push({
                    id: tableId,
                    name: row.table_name,
                    type: row.table_type as 'table' | 'view',
                    parent: `schema_${database}_${row.schema_name}`,
                    metadata: {
                        table_type: row.table_type,
                        schema_name: row.schema_name
                    }
                });

                // Get columns for this table
                const columns = await this.getColumns(database, row.schema_name, row.table_name);
                items.push(...columns);
            }

            return items;

        } catch (error) {
            console.error('Error fetching all schema items:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async getIndexes(database: string, schema: string, table: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    i.indexname as name,
                    i.indexdef,
                    CASE WHEN c.contype = 'p' THEN true ELSE false END as is_primary,
                    CASE WHEN i.indexdef LIKE '%UNIQUE%' THEN true ELSE false END as is_unique
                FROM pg_indexes i
                LEFT JOIN pg_constraint c ON c.conname = i.indexname
                WHERE i.schemaname = $1 AND i.tablename = $2
                ORDER BY is_primary DESC, is_unique DESC, i.indexname
            `, [schema, table], database);

            return result.rows.map((row) => ({
                id: `index_${database}_${schema}_${table}_${row.name}`,
                name: row.name,
                type: 'index' as const,
                parent: `table_${database}_${schema}_${table}`,
                metadata: {
                    definition: row.indexdef,
                    is_primary: row.is_primary,
                    is_unique: row.is_unique
                }
            }));
        } catch (error) {
            console.error('Error fetching indexes:', error);
            throw error;
        }
    }

    async getFunctions(database: string, schema: string): Promise<SchemaItem[]> {
        try {
            // Try a simplified query first
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    routine_name as name,
                    data_type as return_type
                FROM information_schema.routines
                WHERE routine_schema = $1
                    AND routine_type = 'FUNCTION'
                ORDER BY routine_name
            `, [schema], database);

            return result.rows.map((row) => ({
                id: `function_${database}_${schema}_${row.name}`,
                name: row.name,
                type: 'function' as const,
                parent: `schema_${database}_${schema}`,
                metadata: {
                    return_type: row.return_type || 'unknown'
                }
            }));
        } catch (error) {
            console.error('Error fetching functions:', error);
            // If functions are not supported, return empty array instead of throwing
            return [];
        }
    }

    async getTriggers(database: string, schema: string, table: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    trigger_name as name,
                    event_manipulation,
                    action_timing
                FROM information_schema.triggers 
                WHERE event_object_schema = $1 AND event_object_table = $2
                ORDER BY trigger_name
            `, [schema, table], database);

            return result.rows.map((row) => ({
                id: `trigger_${database}_${schema}_${table}_${row.name}`,
                name: row.name,
                type: 'trigger' as const,
                parent: `table_${database}_${schema}_${table}`,
                metadata: {
                    event: row.event_manipulation,
                    timing: row.action_timing
                }
            }));
        } catch (error) {
            console.error('Error fetching triggers:', error);
            // If triggers are not supported, return empty array instead of throwing
            return [];
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            return await this.connectionPool.testConnection();
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }

    async cleanup(): Promise<void> {
        try {
            await this.connectionPool.closeAll();
        } catch (error) {
            console.error('Error during schema service cleanup:', error);
        }
    }
}