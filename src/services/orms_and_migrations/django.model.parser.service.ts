import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface DjangoModel {
    name: string;
    className: string;
    tableName?: string;
    appName: string;
    filePath: string;
    fields: DjangoField[];
    hasMeta: boolean;
}

export interface DjangoField {
    name: string;
    fieldType: string;
    options: string[];
}

export interface DjangoApp {
    name: string;
    path: string;
    models: DjangoModel[];
}

export interface DjangoMigration {
    name: string;
    fileName: string;
    appName: string;
    filePath: string;
    isApplied: boolean;
    timestamp?: string;
}

export class DjangoModelParserService {
    constructor(private projectRoot: string) {}

    /**
     * Find all Django apps in the project
     */
    async findApps(): Promise<DjangoApp[]> {
        const apps: DjangoApp[] = [];

        try {
            // Find all directories that contain models.py
            const pattern = new vscode.RelativePattern(this.projectRoot, '**/models.py');
            const modelFiles = await vscode.workspace.findFiles(
                pattern,
                '{**/venv/**,**/.venv/**,**/env/**,**/node_modules/**,**/migrations/**}'
            );

            for (const modelFile of modelFiles) {
                const appPath = path.dirname(modelFile.fsPath);
                const appName = path.basename(appPath);
                
                // Parse models from the file
                const models = await this.parseModelsFile(modelFile.fsPath, appName);
                
                if (models.length > 0) {
                    apps.push({
                        name: appName,
                        path: appPath,
                        models
                    });
                }
            }

            return apps;
        } catch (error) {
            console.error('[Django Parser] Error finding apps:', error);
            return [];
        }
    }

    /**
     * Parse models.py file to extract model definitions
     */
    private async parseModelsFile(filePath: string, appName: string): Promise<DjangoModel[]> {
        try {
            const content = await fs.promises.readFile(filePath, 'utf8');
            const models: DjangoModel[] = [];
            
            // Regex to find class definitions that inherit from models.Model
            const classRegex = /class\s+(\w+)\s*\([^)]*models\.Model[^)]*\)\s*:/g;
            let match;
            
            while ((match = classRegex.exec(content)) !== null) {
                const className = match[1];
                const classStart = match.index;
                
                // Find the class body (until next class or end of file)
                const nextClass = content.indexOf('\nclass ', classStart + 1);
                const classEnd = nextClass > -1 ? nextClass : content.length;
                const classBody = content.substring(classStart, classEnd);
                
                // Parse fields
                const fields = this.parseFields(classBody);
                
                // Check for Meta class with db_table
                const metaMatch = classBody.match(/class\s+Meta[:\s]/);
                const hasMeta = !!metaMatch;
                let tableName: string | undefined;
                
                if (hasMeta) {
                    const tableNameMatch = classBody.match(/db_table\s*=\s*['"](.*?)['"]/);
                    if (tableNameMatch) {
                        tableName = tableNameMatch[1];
                    }
                }
                
                // Default table name: appname_modelname (lowercase)
                if (!tableName) {
                    tableName = `${appName}_${className.toLowerCase()}`;
                }
                
                models.push({
                    name: className,
                    className,
                    tableName,
                    appName,
                    filePath,
                    fields,
                    hasMeta
                });
            }
            
            return models;
        } catch (error) {
            console.error('[Django Parser] Error parsing models file:', error);
            return [];
        }
    }

    /**
     * Parse fields from class body
     */
    private parseFields(classBody: string): DjangoField[] {
        const fields: DjangoField[] = [];
        
        // Regex to find field definitions
        const fieldRegex = /(\w+)\s*=\s*models\.(\w+)\(([^)]*)\)/g;
        let match;
        
        while ((match = fieldRegex.exec(classBody)) !== null) {
            const [, fieldName, fieldType, options] = match;
            
            fields.push({
                name: fieldName,
                fieldType,
                options: options ? options.split(',').map(o => o.trim()) : []
            });
        }
        
        return fields;
    }

    /**
     * Find all migrations for all apps
     */
    async findMigrations(): Promise<DjangoMigration[]> {
        const migrations: DjangoMigration[] = [];

        try {
            // Find all migration directories
            const pattern = new vscode.RelativePattern(this.projectRoot, '**/migrations/*.py');
            const migrationFiles = await vscode.workspace.findFiles(
                pattern,
                '{**/venv/**,**/.venv/**,**/env/**,**/node_modules/**}'
            );

            for (const migrationFile of migrationFiles) {
                const fileName = path.basename(migrationFile.fsPath);
                
                // Skip __init__.py and __pycache__
                if (fileName === '__init__.py' || fileName.includes('__pycache__')) {
                    continue;
                }
                
                const migrationsDir = path.dirname(migrationFile.fsPath);
                const appDir = path.dirname(migrationsDir);
                const appName = path.basename(appDir);
                
                // Extract timestamp if present (0001, 0002, etc.)
                const timestampMatch = fileName.match(/^(\d{4})/);
                const timestamp = timestampMatch ? timestampMatch[1] : undefined;
                
                migrations.push({
                    name: fileName.replace('.py', ''),
                    fileName,
                    appName,
                    filePath: migrationFile.fsPath,
                    isApplied: false, // Will be updated by checking database
                    timestamp
                });
            }

            // Sort by timestamp
            migrations.sort((a, b) => {
                if (a.appName !== b.appName) {
                    return a.appName.localeCompare(b.appName);
                }
                if (a.timestamp && b.timestamp) {
                    return a.timestamp.localeCompare(b.timestamp);
                }
                return a.name.localeCompare(b.name);
            });

            return migrations;
        } catch (error) {
            console.error('[Django Parser] Error finding migrations:', error);
            return [];
        }
    }

    /**
     * Check migration status against database
     */
    async checkMigrationStatus(
        migrations: DjangoMigration[],
        appliedMigrations: Set<string>
    ): Promise<DjangoMigration[]> {
        return migrations.map(migration => ({
            ...migration,
            isApplied: appliedMigrations.has(`${migration.appName}.${migration.name}`)
        }));
    }
}

