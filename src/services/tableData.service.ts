import * as vscode from 'vscode';
import { StateService } from './state.service';
import { ConnectionPoolService, ManagedClient } from './connectionPool.service';

export interface TableRow {
    [key: string]: any;
    __rowId?: string; // Internal ID for tracking
}

export interface ColumnDefinition {
    name: string;
    type: string;
    nullable: boolean;
    defaultValue: string | null;
    isPrimaryKey: boolean;
    isForeignKey: boolean;
    maxLength?: number;
}

export interface TableDataResult {
    columns: ColumnDefinition[];
    rows: TableRow[];
    totalCount: number;
    hasMore: boolean;
}

export interface InsertRowData {
    [key: string]: any;
}

export interface UpdateRowData {
    primaryKeyValues: { [key: string]: any };
    newValues: { [key: string]: any };
}

export class TableDataService {
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

    async getTableData(
        schema: string, 
        table: string, 
        offset: number = 0, 
        limit: number = 100,
        database?: string
    ): Promise<TableDataResult> {
        let client: ManagedClient | null = null;
        
        try {
            client = await this.getConnection(database);

            // Get column definitions
            const columns = await this.getTableColumns(client, schema, table);
            
            // Get total count
            const countResult = await client.query(`SELECT COUNT(*) as total FROM ${schema}.${table}`);
            const totalCount = parseInt(countResult.rows[0].total);
            
            // Get data with pagination
            const dataQuery = `SELECT * FROM ${schema}.${table} LIMIT ${limit} OFFSET ${offset}`;
            const dataResult = await client.query(dataQuery);
            
            // Add row IDs for tracking
            const rows: TableRow[] = dataResult.rows.map((row, index) => ({
                ...row,
                __rowId: `${offset + index}`
            }));

            return {
                columns,
                rows,
                totalCount,
                hasMore: offset + limit < totalCount
            };

        } catch (error) {
            console.error('Error fetching table data:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    private async getTableColumns(client: ManagedClient, schema: string, table: string): Promise<ColumnDefinition[]> {
        const result = await client.query(`
            SELECT 
                c.column_name as name,
                c.data_type as type,
                c.is_nullable = 'YES' as nullable,
                c.column_default as default_value,
                c.character_maximum_length as max_length,
                CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key,
                CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END as is_foreign_key
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
            ) pk ON c.column_name = pk.column_name
            LEFT JOIN (
                SELECT ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku ON tc.constraint_name = ku.constraint_name
                WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'FOREIGN KEY'
            ) fk ON c.column_name = fk.column_name
            WHERE c.table_schema = $1 AND c.table_name = $2
            ORDER BY c.ordinal_position
        `, [schema, table]);

        return result.rows.map(row => ({
            name: row.name,
            type: row.type,
            nullable: row.nullable,
            defaultValue: row.default_value,
            isPrimaryKey: row.is_primary_key,
            isForeignKey: row.is_foreign_key,
            maxLength: row.max_length
        }));
    }

    async insertRow(
        schema: string, 
        table: string, 
        rowData: InsertRowData,
        database?: string
    ): Promise<TableRow> {
        let client: ManagedClient | null = null;
        
        try {
            client = await this.getConnection(database);

            const columns = Object.keys(rowData).filter(key => rowData[key] !== undefined);
            const values = columns.map(col => rowData[col]);
            const placeholders = columns.map((_, index) => `$${index + 1}`);

            // First, try the insert with RETURNING clause
            let insertQuery = `
                INSERT INTO ${schema}.${table} (${columns.join(', ')})
                VALUES (${placeholders.join(', ')})
                RETURNING *
            `;

            console.debug('Executing insert:', insertQuery, 'with values:', values);
            
            let result;
            try {
                result = await client.query(insertQuery, values);
            } catch (returningError) {
                // If RETURNING clause fails, fall back to INSERT without RETURNING
                console.debug('RETURNING clause failed, falling back to standard INSERT:', returningError);
                
                insertQuery = `
                    INSERT INTO ${schema}.${table} (${columns.join(', ')})
                    VALUES (${placeholders.join(', ')})
                `;
                
                const insertResult = await client.query(insertQuery, values);
                
                if (insertResult.rowCount === 0) {
                    throw new Error('Insert operation did not affect any rows');
                }
                
                // For inserts without RETURNING, we can't easily get the exact row back
                // especially if there are auto-generated columns (like serial IDs)
                // Return a basic representation of what was inserted
                const insertedRow: TableRow = { ...rowData };
                return {
                    ...insertedRow,
                    __rowId: 'new'
                };
            }
            
            if (result.rows.length === 0) {
                throw new Error('Insert operation did not return any data');
            }

            return {
                ...result.rows[0],
                __rowId: 'new'
            };

        } catch (error) {
            console.error('Error inserting row:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async updateRow(
        schema: string, 
        table: string, 
        updateData: UpdateRowData,
        database?: string
    ): Promise<TableRow> {
        let client: ManagedClient | null = null;
        
        try {
            client = await this.getConnection(database);

            // Validate input data
            if (!updateData.newValues || Object.keys(updateData.newValues).length === 0) {
                throw new Error('No values provided for update');
            }

            console.debug('Update data received:', {
                newValues: updateData.newValues,
                primaryKeyValues: updateData.primaryKeyValues
            });

            if (!updateData.primaryKeyValues || Object.keys(updateData.primaryKeyValues).length === 0) {
                // Get table columns to check if there are any primary keys defined
                const columns = await this.getTableColumns(client, schema, table);
                const primaryKeyColumns = columns.filter(col => col.isPrimaryKey);
                
                if (primaryKeyColumns.length === 0) {
                    console.warn(`Table '${schema}.${table}' has no primary key defined. Updates may not work reliably without unique identifiers.`);
                    throw new Error(`Cannot update row: Table '${schema}.${table}' has no primary key defined. Please add a primary key to enable row editing.`);
                } else {
                    throw new Error('Primary key values are required for update operation but were not provided');
                }
            }

            // Build SET clause
            const setColumns = Object.keys(updateData.newValues);
            const setClause = setColumns.map((col, index) => `${col} = $${index + 1}`).join(', ');

            // Build WHERE clause for primary key
            const whereColumns = Object.keys(updateData.primaryKeyValues);
            const whereClause = whereColumns.map((col, index) => `${col} = $${setColumns.length + index + 1}`).join(' AND ');

            // Validate that we have a proper WHERE clause
            if (!whereClause.trim()) {
                throw new Error('Unable to build WHERE clause - no primary key columns found');
            }

            // Combine all values
            const allValues = [...Object.values(updateData.newValues), ...Object.values(updateData.primaryKeyValues)];

            // First, try the update with RETURNING clause
            let updateQuery = `
                UPDATE ${schema}.${table}
                SET ${setClause}
                WHERE ${whereClause}
                RETURNING *
            `;

            console.debug('Executing update:', updateQuery, 'with values:', allValues);
            
            let result;
            try {
                result = await client.query(updateQuery, allValues);
            } catch (returningError) {
                // If RETURNING clause fails, fall back to UPDATE without RETURNING
                console.debug('RETURNING clause failed, falling back to standard UPDATE:', returningError);
                
                updateQuery = `
                    UPDATE ${schema}.${table}
                    SET ${setClause}
                    WHERE ${whereClause}
                `;
                
                const updateResult = await client.query(updateQuery, allValues);
                
                if (updateResult.rowCount === 0) {
                    throw new Error('Update operation did not affect any rows');
                }
                
                // Fetch the updated row with a separate SELECT query
                const selectQuery = `
                    SELECT * FROM ${schema}.${table}
                    WHERE ${whereClause}
                `;
                
                const selectValues = Object.values(updateData.primaryKeyValues);
                result = await client.query(selectQuery, selectValues);
                
                if (result.rows.length === 0) {
                    throw new Error('Could not retrieve updated row');
                }
            }
            
            if (result.rows.length === 0) {
                throw new Error('Update operation did not affect any rows');
            }

            return {
                ...result.rows[0],
                __rowId: 'updated'
            };

        } catch (error) {
            console.error('Error updating row:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async deleteRow(
        schema: string, 
        table: string, 
        primaryKeyValues: { [key: string]: any },
        database?: string
    ): Promise<void> {
        let client: ManagedClient | null = null;
        
        try {
            client = await this.getConnection(database);

            // Build WHERE clause for primary key
            const whereColumns = Object.keys(primaryKeyValues);
            const whereClause = whereColumns.map((col, index) => `${col} = $${index + 1}`).join(' AND ');
            const values = Object.values(primaryKeyValues);

            const deleteQuery = `
                DELETE FROM ${schema}.${table}
                WHERE ${whereClause}
            `;

            console.debug('Executing delete:', deleteQuery, 'with values:', values);
            
            const result = await client.query(deleteQuery, values);
            
            if (result.rowCount === 0) {
                throw new Error('Delete operation did not affect any rows');
            }

        } catch (error) {
            console.error('Error deleting row:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    private getPrimaryKeyColumns(columns: ColumnDefinition[]): ColumnDefinition[] {
        return columns.filter(col => col.isPrimaryKey);
    }

    async getPrimaryKeyValues(row: TableRow, columns: ColumnDefinition[]): Promise<{ [key: string]: any }> {
        const pkColumns = this.getPrimaryKeyColumns(columns);
        const pkValues: { [key: string]: any } = {};

        for (const col of pkColumns) {
            pkValues[col.name] = row[col.name];
        }

        return pkValues;
    }

    validateRowData(rowData: InsertRowData, columns: ColumnDefinition[]): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        for (const column of columns) {
            const value = rowData[column.name];

            // Check required fields
            if (!column.nullable && (value === null || value === undefined || value === '')) {
                errors.push(`${column.name} is required`);
            }

            // Check data types (enhanced validation)
            if (value !== null && value !== undefined && value !== '') {
                const type = column.type.toLowerCase();
                
                // Numeric validation
                if ((type.includes('int') || type.includes('serial')) && isNaN(parseInt(String(value)))) {
                    errors.push(`${column.name} must be a valid integer`);
                } else if ((type.includes('numeric') || type.includes('decimal') || type.includes('float') || type.includes('double') || type.includes('real')) && isNaN(parseFloat(String(value)))) {
                    errors.push(`${column.name} must be a valid number`);
                }
                
                // JSON validation
                if ((type === 'json' || type === 'jsonb') && typeof value === 'string') {
                    try {
                        JSON.parse(value);
                    } catch (e) {
                        errors.push(`${column.name} must be valid JSON`);
                    }
                }
                
                // Boolean validation
                if (type.includes('bool') && typeof value !== 'boolean' && typeof value === 'string') {
                    const lowerValue = value.toLowerCase();
                    if (!['true', 'false', 't', 'f', '1', '0'].includes(lowerValue)) {
                        errors.push(`${column.name} must be a valid boolean value`);
                    }
                }
                
                // UUID validation (basic format check)
                if (type === 'uuid' && typeof value === 'string') {
                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
                    if (!uuidRegex.test(value)) {
                        errors.push(`${column.name} must be a valid UUID format`);
                    }
                }
                
                // String length validation
                if (column.maxLength && typeof value === 'string' && value.length > column.maxLength) {
                    errors.push(`${column.name} must be ${column.maxLength} characters or less`);
                }
                
                // Date/Time validation (basic check)
                if ((type === 'date' || type.includes('timestamp') || type.includes('time')) && typeof value === 'string') {
                    const date = new Date(value);
                    if (isNaN(date.getTime())) {
                        errors.push(`${column.name} must be a valid date/time format`);
                    }
                }
            }
        }

        return { isValid: errors.length === 0, errors };
    }
}