import * as vscode from 'vscode';
import { Client } from 'pg';
import { StateService } from './state.service';
import { ConnectionPoolService, ManagedClient } from './connectionPool.service';

export interface SchemaItem {
    id: string;
    name: string;
    type: 'connection' | 'database' | 'schema' | 'table' | 'view' | 'column' | 'index' | 'function' | 'trigger' | 'sequence' | 'foreignkey' | 'role' | 'container';
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
                id: `schema_v2_${database}_${row.name}`,  // v2: container structure
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
            console.log(`[SCHEMA SERVICE] Fetching tables for ${database}.${schema}`);
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    table_name as name,
                    table_type
                FROM information_schema.tables 
                WHERE table_schema = $1
                    AND table_type = 'BASE TABLE'
                ORDER BY table_name
            `, [schema], database);

            console.log(`[SCHEMA SERVICE] Query returned ${result.rows.length} tables:`, result.rows.map(r => r.name));
            
            const tables = result.rows.map((row) => ({
                id: `table_${database}_${schema}_${row.name}`,
                name: row.name,
                type: 'table' as const,
                parent: `schema_v2_${database}_${schema}`,
                metadata: {
                    table_type: row.table_type,
                    is_materialized: false
                }
            }));
            
            console.log(`[SCHEMA SERVICE] Mapped to ${tables.length} SchemaItems with parent IDs:`, tables.map(t => ({ name: t.name, parent: t.parent })));
            return tables;
        } catch (error) {
            console.error('Error fetching tables:', error);
            throw error;
        }
    }

    async getViews(database: string, schema: string): Promise<SchemaItem[]> {
        try {
            console.log(`[SCHEMA SERVICE] Fetching views for ${database}.${schema}`);
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    viewname as name,
                    'VIEW' as table_type
                FROM pg_views
                WHERE schemaname = $1
                UNION ALL
                SELECT 
                    matviewname as name,
                    'MATERIALIZED VIEW' as table_type
                FROM pg_matviews
                WHERE schemaname = $1
                ORDER BY table_type, name
            `, [schema], database);

            console.log(`[SCHEMA SERVICE] Query returned ${result.rows.length} views:`, result.rows.map(r => `${r.name} (${r.table_type})`));
            
            const views = result.rows.map((row) => ({
                id: `view_${database}_${schema}_${row.name}`,
                name: row.name,
                type: 'view' as const,
                parent: `schema_v2_${database}_${schema}`,
                metadata: {
                    table_type: row.table_type,
                    is_materialized: row.table_type === 'MATERIALIZED VIEW'
                }
            }));
            
            console.log(`[SCHEMA SERVICE] Mapped to ${views.length} view SchemaItems with parent IDs:`, views.map(v => ({ name: v.name, parent: v.parent })));
            return views;
        } catch (error) {
            console.error('Error fetching views:', error);
            throw error;
        }
    }

    async getSequences(database: string, schema: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    sequence_name as name,
                    data_type,
                    start_value,
                    increment,
                    maximum_value,
                    minimum_value,
                    cycle_option
                FROM information_schema.sequences
                WHERE sequence_schema = $1
                ORDER BY sequence_name
            `, [schema], database);

            return result.rows.map((row) => ({
                id: `sequence_${database}_${schema}_${row.name}`,
                name: row.name,
                type: 'sequence' as const,
                parent: `schema_v2_${database}_${schema}`,
                metadata: {
                    data_type: row.data_type,
                    start_value: row.start_value,
                    increment: row.increment,
                    maximum_value: row.maximum_value,
                    minimum_value: row.minimum_value,
                    cycle_option: row.cycle_option
                }
            }));
        } catch (error) {
            console.error('Error fetching sequences:', error);
            throw error;
        }
    }

    async getForeignKeys(database: string, schema: string, tableName: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT DISTINCT
                    tc.constraint_name as name,
                    tc.table_name,
                    string_agg(kcu.column_name, ', ' ORDER BY kcu.ordinal_position) as columns,
                    ccu.table_schema AS foreign_table_schema,
                    ccu.table_name AS foreign_table_name,
                    string_agg(ccu.column_name, ', ' ORDER BY kcu.ordinal_position) as foreign_columns,
                    rc.update_rule,
                    rc.delete_rule
                FROM information_schema.table_constraints AS tc
                JOIN information_schema.key_column_usage AS kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage AS ccu
                    ON ccu.constraint_name = tc.constraint_name
                    AND ccu.table_schema = tc.table_schema
                JOIN information_schema.referential_constraints AS rc
                    ON rc.constraint_name = tc.constraint_name
                    AND rc.constraint_schema = tc.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY'
                    AND tc.table_schema = $1
                    AND tc.table_name = $2
                GROUP BY 
                    tc.constraint_name, 
                    tc.table_name,
                    ccu.table_schema,
                    ccu.table_name,
                    rc.update_rule,
                    rc.delete_rule
                ORDER BY tc.constraint_name
            `, [schema, tableName], database);

            return result.rows.map((row) => ({
                id: `foreignkey_${database}_${schema}_${tableName}_${row.name}`,
                name: row.name,
                type: 'foreignkey' as const,
                parent: `table_${database}_${schema}_${tableName}`,
                metadata: {
                    columns: row.columns,
                    foreign_table_schema: row.foreign_table_schema,
                    foreign_table_name: row.foreign_table_name,
                    foreign_columns: row.foreign_columns,
                    update_rule: row.update_rule,
                    delete_rule: row.delete_rule
                }
            }));
        } catch (error) {
            console.error('Error fetching foreign keys:', error);
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
                    parent: `schema_v2_${database}_${row.schema_name}`,
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
                parent: `schema_v2_${database}_${schema}`,
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

    async getConstraints(database: string, schema: string, tableName: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    con.conname as name,
                    con.contype as constraint_type,
                    pg_get_constraintdef(con.oid) as definition,
                    con.condeferrable as is_deferrable,
                    con.condeferred as is_deferred
                FROM pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
                WHERE rel.relname = $1
                    AND nsp.nspname = $2
                    AND con.contype IN ('c', 'u', 'x')
                ORDER BY con.conname
            `, [tableName, schema], database);

            return result.rows.map((row) => {
                let constraintTypeLabel = '';
                switch (row.constraint_type) {
                    case 'c':
                        constraintTypeLabel = 'CHECK';
                        break;
                    case 'u':
                        constraintTypeLabel = 'UNIQUE';
                        break;
                    case 'x':
                        constraintTypeLabel = 'EXCLUSION';
                        break;
                }

                return {
                    id: `constraint_${database}_${schema}_${tableName}_${row.name}`,
                    name: row.name,
                    type: 'constraint' as const,
                    parent: `table_${database}_${schema}_${tableName}`,
                    metadata: {
                        constraint_type: row.constraint_type,
                        constraint_type_label: constraintTypeLabel,
                        definition: row.definition,
                        is_deferrable: row.is_deferrable,
                        is_deferred: row.is_deferred
                    }
                };
            });
        } catch (error) {
            console.error('Error fetching constraints:', error);
            throw error;
        }
    }

    async getPolicies(database: string, schema: string, tableName: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    pol.polname as name,
                    pol.polpermissive as is_permissive,
                    pol.polcmd as command,
                    ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) as roles,
                    pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
                    pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expression
                FROM pg_policy pol
                JOIN pg_class c ON pol.polrelid = c.oid
                JOIN pg_namespace n ON c.relnamespace = n.oid
                WHERE c.relname = $1
                    AND n.nspname = $2
                ORDER BY pol.polname
            `, [tableName, schema], database);

            return result.rows.map((row) => {
                let commandLabel = '';
                switch (row.command) {
                    case '*': commandLabel = 'ALL'; break;
                    case 'r': commandLabel = 'SELECT'; break;
                    case 'a': commandLabel = 'INSERT'; break;
                    case 'w': commandLabel = 'UPDATE'; break;
                    case 'd': commandLabel = 'DELETE'; break;
                    default: commandLabel = 'UNKNOWN'; break;
                }

                const typeLabel = row.is_permissive ? 'PERMISSIVE' : 'RESTRICTIVE';

                return {
                    id: `policy_${database}_${schema}_${tableName}_${row.name}`,
                    name: row.name,
                    type: 'policy' as const,
                    parent: `table_${database}_${schema}_${tableName}`,
                    metadata: {
                        is_permissive: row.is_permissive,
                        type_label: typeLabel,
                        command: row.command,
                        command_label: commandLabel,
                        roles: row.roles,
                        using_expression: row.using_expression,
                        with_check_expression: row.with_check_expression
                    }
                };
            });
        } catch (error) {
            console.error('Error fetching policies:', error);
            throw error;
        }
    }

    async getTriggers(database: string, schema: string, table: string): Promise<SchemaItem[]> {
        try {
            const result = await this.connectionPool.executeQuery(`
                SELECT 
                    t.tgname as name,
                    t.tgenabled as is_enabled,
                    CASE t.tgtype::int & 66
                        WHEN 2 THEN 'BEFORE'
                        WHEN 64 THEN 'INSTEAD OF'
                        ELSE 'AFTER'
                    END as timing,
                    ARRAY(
                        SELECT CASE 
                            WHEN t.tgtype::int & 4 != 0 THEN 'INSERT'
                            WHEN t.tgtype::int & 8 != 0 THEN 'DELETE'
                            WHEN t.tgtype::int & 16 != 0 THEN 'UPDATE'
                            WHEN t.tgtype::int & 32 != 0 THEN 'TRUNCATE'
                        END
                    ) as events,
                    CASE t.tgtype::int & 1
                        WHEN 1 THEN 'ROW'
                        ELSE 'STATEMENT'
                    END as level,
                    p.proname as function_name,
                    n.nspname as function_schema
                FROM pg_trigger t
                JOIN pg_class c ON t.tgrelid = c.oid
                JOIN pg_namespace ns ON c.relnamespace = ns.oid
                JOIN pg_proc p ON t.tgfoid = p.oid
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE ns.nspname = $1
                    AND c.relname = $2
                    AND NOT t.tgisinternal
                ORDER BY t.tgname
            `, [schema, table], database);

            return result.rows.map((row) => ({
                id: `trigger_${database}_${schema}_${table}_${row.name}`,
                name: row.name,
                type: 'trigger' as const,
                parent: `table_${database}_${schema}_${table}`,
                metadata: {
                    timing: row.timing,
                    events: row.events,
                    level: row.level,
                    is_enabled: row.is_enabled === 'O' || row.is_enabled === 't',
                    function_name: row.function_name,
                    function_schema: row.function_schema
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