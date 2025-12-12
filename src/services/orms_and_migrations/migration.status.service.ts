import { StateService } from '../state.service';
import { SqlQueryService } from '../sqlQuery.service';
import * as vscode from 'vscode';

export class MigrationStatusService {
    private sqlService: SqlQueryService;

    constructor(
        private stateService: StateService,
        private context: vscode.ExtensionContext
    ) {
        this.sqlService = new SqlQueryService(stateService, context);
    }

    /**
     * Get applied Django migrations from database
     */
    async getDjangoAppliedMigrations(database?: string): Promise<Set<string>> {
        try {
            const viewData = await this.stateService.getViewData();
            const targetDb = database || viewData.selectedDatabase;

            // Query django_migrations table
            const sql = `
                SELECT app, name 
                FROM django_migrations 
                ORDER BY applied DESC
            `;

            const result = await this.sqlService.executeQuery(sql, targetDb);
            
            const applied = new Set<string>();
            if (result.rows) {
                for (const row of result.rows) {
                    applied.add(`${row.app}.${row.name}`);
                }
            }

            return applied;
        } catch (error) {
            console.error('[Migration Status] Error getting Django migrations:', error);
            // Table might not exist yet
            return new Set();
        }
    }

    /**
     * Get applied Prisma migrations from database
     */
    async getPrismaAppliedMigrations(database?: string): Promise<Set<string>> {
        try {
            const viewData = await this.stateService.getViewData();
            const targetDb = database || viewData.selectedDatabase;

            // Query _prisma_migrations table
            const sql = `
                SELECT migration_name, finished_at 
                FROM _prisma_migrations 
                WHERE finished_at IS NOT NULL
                ORDER BY finished_at DESC
            `;

            const result = await this.sqlService.executeQuery(sql, targetDb);
            
            const applied = new Set<string>();
            if (result.rows) {
                for (const row of result.rows) {
                    applied.add(row.migration_name);
                }
            }

            return applied;
        } catch (error) {
            console.error('[Migration Status] Error getting Prisma migrations:', error);
            // Table might not exist yet
            return new Set();
        }
    }

    /**
     * Check if a table exists in database
     */
    async tableExists(tableName: string, schema: string = 'public', database?: string): Promise<boolean> {
        try {
            const viewData = await this.stateService.getViewData();
            const targetDb = database || viewData.selectedDatabase;

            const sql = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = $1 
                    AND table_name = $2
                )
            `;

            const result = await this.sqlService.executeQuery(sql, [schema, tableName], targetDb);
            
            return result.rows?.[0]?.exists || false;
        } catch (error) {
            console.error('[Migration Status] Error checking table existence:', error);
            return false;
        }
    }

    /**
     * Get table column information
     */
    async getTableColumns(tableName: string, schema: string = 'public', database?: string): Promise<any[]> {
        try {
            const viewData = await this.stateService.getViewData();
            const targetDb = database || viewData.selectedDatabase;

            const sql = `
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns
                WHERE table_schema = $1 
                AND table_name = $2
                ORDER BY ordinal_position
            `;

            const result = await this.sqlService.executeQuery(sql, [schema, tableName], targetDb);
            
            return result.rows || [];
        } catch (error) {
            console.error('[Migration Status] Error getting table columns:', error);
            return [];
        }
    }

    /**
     * Detect schema drift for Django model
     */
    async detectDjangoDrift(
        modelTableName: string,
        modelFields: any[],
        schema: string = 'public',
        database?: string
    ): Promise<{
        hasChanges: boolean;
        tableExists: boolean;
        missingFields: string[];
        extraFields: string[];
    }> {
        const tableExists = await this.tableExists(modelTableName, schema, database);
        
        if (!tableExists) {
            return {
                hasChanges: true,
                tableExists: false,
                missingFields: modelFields.map(f => f.name),
                extraFields: []
            };
        }

        const dbColumns = await this.getTableColumns(modelTableName, schema, database);
        const dbColumnNames = new Set(dbColumns.map(c => c.column_name));
        const modelFieldNames = new Set(modelFields.map(f => f.name));

        const missingFields = modelFields
            .filter(f => !dbColumnNames.has(f.name))
            .map(f => f.name);

        const extraFields = dbColumns
            .filter(c => !modelFieldNames.has(c.column_name))
            .map(c => c.column_name);

        return {
            hasChanges: missingFields.length > 0 || extraFields.length > 0,
            tableExists: true,
            missingFields,
            extraFields
        };
    }

    /**
     * Detect schema drift for Prisma model
     */
    async detectPrismaDrift(
        modelTableName: string,
        modelFields: any[],
        schema: string = 'public',
        database?: string
    ): Promise<{
        hasChanges: boolean;
        tableExists: boolean;
        missingFields: string[];
        extraFields: string[];
    }> {
        // Same logic as Django for now
        return this.detectDjangoDrift(modelTableName, modelFields, schema, database);
    }
}

