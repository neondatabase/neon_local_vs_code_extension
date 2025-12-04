import * as vscode from 'vscode';
import { Client } from 'pg';
import { StateService } from './state.service';
import { ConnectionPoolService, ManagedClient } from './connectionPool.service';

export interface QueryResult {
    columns: string[];
    rows: any[];
    rowCount: number;
    executionTime: number;
    affectedRows?: number;
    performanceStats?: PerformanceStats;
}

export interface PerformanceStats {
    executionTime: number;
    connectionTime: number;
    queryPlanningTime?: number;
    queryExecutionTime?: number;
    bytesReceived?: number;
    rowsReturned: number;
    rowsAffected?: number;
    cacheHits?: number;
    diskReads?: number;
    memoryUsage?: number;
    queryComplexity?: string;
    indexesUsed?: string[];
    tablesScanStatus?: {[tableName: string]: 'seq_scan' | 'index_scan' | 'bitmap_scan'};
}

export interface QueryError {
    message: string;
    line?: number;
    position?: number;
    detail?: string;
    where?: string;
    code?: string;
}

export class SqlQueryService {
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

    async executeQuery(sql: string, paramsOrDatabase?: any[] | string, database?: string): Promise<QueryResult> {
        let client: ManagedClient | null = null;
        const startTime = Date.now();
        let connectionTime = 0;
        
        // Handle overloaded parameters
        let params: any[] = [];
        let targetDb: string | undefined;
        
        if (Array.isArray(paramsOrDatabase)) {
            // Called with (sql, params, database)
            params = paramsOrDatabase;
            targetDb = database;
        } else {
            // Called with (sql, database)
            targetDb = paramsOrDatabase;
        }
        
        // Clean the SQL query (move outside try block so it's accessible in catch)
        const cleanSql = sql.trim();
        if (!cleanSql) {
            throw new Error('SQL query cannot be empty');
        }
        
        try {
            const connectionStart = Date.now();
            client = await this.getConnection(targetDb);
            connectionTime = Date.now() - connectionStart;

            console.debug('Executing SQL query:', cleanSql, 'with params:', params);
            
            const queryStart = Date.now();
            const result = await client.query(cleanSql, params);
            const queryExecutionTime = Date.now() - queryStart;
            const executionTime = Date.now() - startTime;
            
            // Collect performance stats after successful execution
            const performanceStats = await this.collectPerformanceStats(client, cleanSql, startTime, connectionTime);

            // Handle different types of results
            const columns = result.fields ? result.fields.map(field => field.name) : [];
            const rows = result.rows || [];
            const rowCount = rows.length;
            const affectedRows = result.rowCount;

            console.debug(`Query executed successfully in ${executionTime}ms, ${rowCount} rows returned`);

            // Complete performance stats
            performanceStats.queryExecutionTime = queryExecutionTime;
            performanceStats.executionTime = executionTime;
            performanceStats.rowsReturned = rowCount;
            performanceStats.rowsAffected = affectedRows;
            performanceStats.bytesReceived = this.estimateBytesReceived(rows, columns);

            return {
                columns,
                rows,
                rowCount,
                executionTime,
                affectedRows,
                performanceStats
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            console.error('SQL query execution failed:', error);
            
            // Parse PostgreSQL error for better user experience
            const pgError = error as any;
            
            // Log all error properties for debugging
            console.log('🔍 PostgreSQL error properties:', Object.keys(pgError));
            console.log('🔍 Error message:', pgError.message);
            console.log('🔍 Error line:', pgError.line);
            console.log('🔍 Error position:', pgError.position);
            console.log('🔍 Error where:', pgError.where);
            console.log('🔍 Error file:', pgError.file);
            console.log('🔍 Error routine:', pgError.routine);
            console.log('🔍 Error code:', pgError.code);
            console.log('🔍 Error severity:', pgError.severity);
            console.log('🔍 Error hint:', pgError.hint);
            console.log('🔍 Error internalPosition:', pgError.internalPosition);
            console.log('🔍 Error internalQuery:', pgError.internalQuery);
            
            // Log all properties dynamically
            Object.keys(pgError).forEach(key => {
                console.log(`🔍 Error.${key}:`, pgError[key]);
            });
            
            // Calculate the correct line number by adjusting for any prefix content
            let adjustedLine = pgError.line ? parseInt(pgError.line) : undefined;
            let adjustedPosition = pgError.position ? parseInt(pgError.position) : undefined;
            
            console.log('🔍 Line number correction check:');
            console.log('🔍   adjustedLine:', adjustedLine);
            console.log('🔍   adjustedPosition:', adjustedPosition);
            console.log('🔍   Both truthy?', !!(adjustedLine && adjustedPosition));
            
            if (adjustedLine && adjustedPosition) {
                try {
                    // Count the actual lines in our clean SQL query
                    const actualLines = cleanSql.split('\n').length;
                    console.log('🔍 Actual SQL lines:', actualLines);
                    console.log('🔍 PostgreSQL reported line:', adjustedLine);
                    console.log('🔍 PostgreSQL reported position:', adjustedPosition);
                    console.log('🔍 Clean SQL length:', cleanSql.length);
                    
                    // If PostgreSQL reports a line number much higher than our actual query,
                    // there's likely some prefix content. Let's try to calculate the correct line.
                    if (adjustedLine > actualLines * 10) { // Heuristic: if reported line is way too high
                        console.log('🔍 Detected inflated line number, attempting to correct...');
                        
                        // Try to find the position within our actual query
                        if (adjustedPosition <= cleanSql.length) {
                            console.log('🔍 Position is within query bounds, calculating line...');
                            // Calculate line number based on position within our query
                            const textBeforeError = cleanSql.substring(0, adjustedPosition);
                            const correctedLine = textBeforeError.split('\n').length;
                            console.log('🔍 Text before error:', JSON.stringify(textBeforeError));
                            console.log('🔍 Corrected line number:', correctedLine);
                            adjustedLine = correctedLine;
                        } else {
                            console.log('🔍 Position is outside query bounds, using fallback...');
                            // Position is also inflated, try to extract from error message
                            const errorText = pgError.message || '';
                            if (errorText.includes('at or near')) {
                                // For now, just report line 1 for syntax errors
                                adjustedLine = 1;
                                console.log('🔍 Defaulting to line 1 for syntax error');
                            }
                        }
                    } else {
                        console.log('🔍 Line number seems reasonable, keeping original');
                    }
                } catch (error) {
                    console.log('🔍 Error in line number correction:', error);
                }
            }

            console.log('🔍 Final error object construction:');
            console.log('🔍   Final adjustedLine:', adjustedLine);
            console.log('🔍   Final adjustedPosition:', adjustedPosition);

            const queryError: QueryError = {
                message: pgError.message || 'Unknown database error',
                line: adjustedLine,
                position: adjustedPosition,
                detail: pgError.detail,
                where: pgError.where,
                code: pgError.code
            };

            throw queryError;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async explainQuery(sql: string, database?: string): Promise<QueryResult> {
        const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
        return this.executeQuery(explainSql, database);
    }

    async getTablePreview(schema: string, table: string, limit: number = 100, database?: string): Promise<QueryResult> {
        const sql = `SELECT * FROM ${schema}.${table} LIMIT ${limit}`;
        return this.executeQuery(sql, database);
    }

    async getTableInfo(schema: string, table: string, database?: string): Promise<{
        columns: any[];
        indexes: any[];
        constraints: any[];
    }> {
        let client: ManagedClient | null = null;
        
        try {
            client = await this.getConnection(database);

            // Get column information
            const columnsResult = await client.query(`
                SELECT 
                    column_name,
                    data_type,
                    is_nullable,
                    column_default,
                    character_maximum_length,
                    numeric_precision,
                    numeric_scale
                FROM information_schema.columns 
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY ordinal_position
            `, [schema, table]);

            // Get index information  
            const indexesResult = await client.query(`
                SELECT 
                    indexname as name,
                    indexdef as definition
                FROM pg_indexes 
                WHERE schemaname = $1 AND tablename = $2
                ORDER BY indexname
            `, [schema, table]);

            // Get constraint information
            const constraintsResult = await client.query(`
                SELECT 
                    constraint_name,
                    constraint_type
                FROM information_schema.table_constraints 
                WHERE table_schema = $1 AND table_name = $2
                ORDER BY constraint_name
            `, [schema, table]);

            return {
                columns: columnsResult.rows,
                indexes: indexesResult.rows,
                constraints: constraintsResult.rows
            };

        } catch (error) {
            console.error('Error getting table info:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    validateSql(sql: string): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];
        const trimmedSql = sql.trim();

        if (!trimmedSql) {
            errors.push('SQL query cannot be empty');
            return { isValid: false, errors };
        }

        // Basic SQL validation
        const dangerousPatterns = [
            /drop\s+database/i,
            /drop\s+schema/i,
            /drop\s+table/i,
            /truncate\s+table/i,
            /delete\s+from.*without.*where/i
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(trimmedSql)) {
                errors.push('Potentially dangerous operation detected. Please be careful with destructive queries.');
                break;
            }
        }

        return { isValid: errors.length === 0, errors };
    }

    formatSql(sql: string): string {
        // Basic SQL formatting
        return sql
            .replace(/\s+/g, ' ')
            .replace(/,/g, ',\n    ')
            .replace(/\bSELECT\b/gi, 'SELECT')
            .replace(/\bFROM\b/gi, '\nFROM')
            .replace(/\bWHERE\b/gi, '\nWHERE')
            .replace(/\bORDER BY\b/gi, '\nORDER BY')
            .replace(/\bGROUP BY\b/gi, '\nGROUP BY')
            .replace(/\bHAVING\b/gi, '\nHAVING')
            .replace(/\bJOIN\b/gi, '\nJOIN')
            .replace(/\bLEFT JOIN\b/gi, '\nLEFT JOIN')
            .replace(/\bRIGHT JOIN\b/gi, '\nRIGHT JOIN')
            .replace(/\bINNER JOIN\b/gi, '\nINNER JOIN')
            .trim();
    }

    private async collectPerformanceStats(
        client: ManagedClient, 
        sql: string, 
        startTime: number, 
        connectionTime: number
    ): Promise<PerformanceStats> {
        const stats: PerformanceStats = {
            executionTime: 0, // Will be set later
            connectionTime,
            rowsReturned: 0, // Will be set later
        };

        try {
            // Get query plan for analysis (but don't execute the query yet)
            const explainSql = `EXPLAIN (ANALYZE false, BUFFERS false, FORMAT JSON) ${sql}`;
            const explainResult = await client.query(explainSql);
            if (explainResult.rows && explainResult.rows[0] && explainResult.rows[0]['QUERY PLAN']) {
                const plan = explainResult.rows[0]['QUERY PLAN'][0];
                
                if (plan) {
                    stats.queryPlanningTime = plan['Planning Time'];
                    
                    // Analyze execution plan for complexity and indexes
                    const analysis = this.analyzePlan(plan);
                    stats.queryComplexity = analysis.complexity;
                    stats.indexesUsed = analysis.indexesUsed;
                    stats.tablesScanStatus = analysis.scanStatus;
                }
            }
        } catch (error) {
            // If EXPLAIN fails, continue without detailed stats
            console.debug('Could not collect detailed performance stats:', error);
        }

        return stats;
    }

    private analyzePlan(plan: any): {
        complexity: string;
        indexesUsed: string[];
        scanStatus: {[tableName: string]: 'seq_scan' | 'index_scan' | 'bitmap_scan'};
    } {
        let complexity = 'Simple';
        const indexesUsed: string[] = [];
        const scanStatus: {[tableName: string]: 'seq_scan' | 'index_scan' | 'bitmap_scan'} = {};

        const analyzePlanNode = (node: any) => {
            if (!node) return;

            // Check node type for complexity
            if (node['Node Type']) {
                const nodeType = node['Node Type'];
                
                // Determine complexity
                if (nodeType.includes('Join') || nodeType.includes('Aggregate') || nodeType.includes('Sort')) {
                    complexity = complexity === 'Simple' ? 'Moderate' : 'Complex';
                }
                if (nodeType.includes('Nested Loop') || nodeType.includes('Hash Join') || nodeType.includes('Merge Join')) {
                    complexity = 'Complex';
                }

                // Track scan types and indexes
                if (nodeType === 'Index Scan' || nodeType === 'Index Only Scan') {
                    if (node['Index Name']) {
                        indexesUsed.push(node['Index Name']);
                    }
                    if (node['Relation Name']) {
                        scanStatus[node['Relation Name']] = 'index_scan';
                    }
                } else if (nodeType === 'Bitmap Index Scan') {
                    if (node['Index Name']) {
                        indexesUsed.push(node['Index Name']);
                    }
                    complexity = 'Moderate';
                } else if (nodeType === 'Bitmap Heap Scan') {
                    if (node['Relation Name']) {
                        scanStatus[node['Relation Name']] = 'bitmap_scan';
                    }
                } else if (nodeType === 'Seq Scan') {
                    if (node['Relation Name']) {
                        scanStatus[node['Relation Name']] = 'seq_scan';
                    }
                    if (complexity === 'Simple') {
                        complexity = 'Moderate'; // Sequential scans can be expensive
                    }
                }
            }

            // Recursively analyze child plans
            if (node['Plans']) {
                node['Plans'].forEach(analyzePlanNode);
            }
        };

        analyzePlanNode(plan);

        return {
            complexity,
            indexesUsed: [...new Set(indexesUsed)], // Remove duplicates
            scanStatus
        };
    }

    private estimateBytesReceived(rows: any[], columns: string[]): number {
        if (!rows || rows.length === 0) return 0;
        
        // Rough estimation based on typical PostgreSQL data sizes
        let totalBytes = 0;
        
        rows.forEach(row => {
            columns.forEach(col => {
                const value = row[col];
                if (value === null || value === undefined) {
                    totalBytes += 4; // NULL overhead
                } else if (typeof value === 'string') {
                    totalBytes += value.length * 2; // UTF-8 estimation
                } else if (typeof value === 'number') {
                    totalBytes += 8; // Assume 8-byte numbers
                } else if (typeof value === 'boolean') {
                    totalBytes += 1;
                } else {
                    totalBytes += JSON.stringify(value).length * 2; // JSON serialization estimate
                }
            });
            totalBytes += columns.length * 4; // Row overhead
        });
        
        return totalBytes;
    }

    async cleanup(): Promise<void> {
        try {
            await this.connectionPool.closeAll();
        } catch (error) {
            console.error('Error during SQL query service cleanup:', error);
        }
    }
}