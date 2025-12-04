import * as vscode from 'vscode';
import * as fs from 'fs';

export interface PrismaModel {
    name: string;
    tableName: string;
    fields: PrismaField[];
    filePath: string;
}

export interface PrismaField {
    name: string;
    type: string;
    isOptional: boolean;
    isArray: boolean;
    attributes: string[];
}

export interface PrismaMigration {
    id: string;
    name: string;
    isApplied: boolean;
    appliedAt?: Date;
}

export class PrismaModelParserService {
    constructor(private schemaPath: string) {}

    /**
     * Parse Prisma schema file to extract models
     */
    async parseModels(): Promise<PrismaModel[]> {
        try {
            const content = await fs.promises.readFile(this.schemaPath, 'utf8');
            const models: PrismaModel[] = [];
            
            // Regex to find model definitions
            const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
            let match;
            
            while ((match = modelRegex.exec(content)) !== null) {
                const [, modelName, modelBody] = match;
                
                // Parse fields
                const fields = this.parseFields(modelBody);
                
                // Check for @@map attribute for custom table name
                const mapMatch = modelBody.match(/@@map\s*\(\s*["']([^"']+)["']\s*\)/);
                const tableName = mapMatch ? mapMatch[1] : modelName;
                
                models.push({
                    name: modelName,
                    tableName,
                    fields,
                    filePath: this.schemaPath
                });
            }
            
            return models;
        } catch (error) {
            console.error('[Prisma Parser] Error parsing schema:', error);
            return [];
        }
    }

    /**
     * Parse fields from model body
     */
    private parseFields(modelBody: string): PrismaField[] {
        const fields: PrismaField[] = [];
        const lines = modelBody.split('\n');
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip comments, empty lines, and attributes
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) {
                continue;
            }
            
            // Parse field: name Type? @attribute
            const fieldMatch = trimmed.match(/^(\w+)\s+([\w\[\]]+)(\?)?\s*(.*)?$/);
            if (fieldMatch) {
                const [, fieldName, fieldType, optional, rest] = fieldMatch;
                
                const isOptional = !!optional;
                const isArray = fieldType.includes('[');
                const cleanType = fieldType.replace(/[\[\]]/g, '');
                
                // Parse attributes (@id, @unique, @default, @map, etc.)
                const attributes: string[] = [];
                if (rest) {
                    const attrMatches = rest.matchAll(/@(\w+)(?:\([^)]*\))?/g);
                    for (const attrMatch of attrMatches) {
                        attributes.push(attrMatch[0]);
                    }
                }
                
                fields.push({
                    name: fieldName,
                    type: cleanType,
                    isOptional,
                    isArray,
                    attributes
                });
            }
        }
        
        return fields;
    }

    /**
     * Find Prisma migrations
     */
    async findMigrations(): Promise<PrismaMigration[]> {
        try {
            const migrationsDir = this.schemaPath.replace('schema.prisma', 'migrations');
            
            // Check if migrations directory exists
            try {
                await fs.promises.access(migrationsDir);
            } catch {
                return [];
            }
            
            const entries = await fs.promises.readdir(migrationsDir, { withFileTypes: true });
            const migrations: PrismaMigration[] = [];
            
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    // Each directory is a migration
                    migrations.push({
                        id: entry.name,
                        name: entry.name,
                        isApplied: false, // Will be updated by checking database
                    });
                }
            }
            
            // Sort by timestamp (directory names are typically timestamped)
            migrations.sort((a, b) => a.name.localeCompare(b.name));
            
            return migrations;
        } catch (error) {
            console.error('[Prisma Parser] Error finding migrations:', error);
            return [];
        }
    }

    /**
     * Check if schema has unapplied changes
     */
    async hasUnappliedChanges(): Promise<boolean> {
        // This would require running `prisma migrate status` or comparing schema with database
        // For now, return false - can be enhanced later
        return false;
    }
}

