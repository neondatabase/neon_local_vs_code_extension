import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export type ORMType = 'django' | 'prisma' | 'typeorm' | 'sequelize' | 'knex' | 'rails' | 'laravel';

export interface ORMConfig {
    type: ORMType;
    name: string;
    icon: string;
    detected: boolean;
    configPath?: string;
    projectRoot?: string;
}

export class ORMDetectorService {
    /**
     * Detect all ORMs in the workspace
     */
    async detectORMs(): Promise<ORMConfig[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }

        const detectedORMs: ORMConfig[] = [];

        for (const workspaceFolder of workspaceFolders) {
            const rootPath = workspaceFolder.uri.fsPath;

            // Check for Django
            const djangoConfig = await this.detectDjango(rootPath);
            if (djangoConfig) {
                detectedORMs.push(djangoConfig);
            }

            // Check for Prisma
            const prismaConfig = await this.detectPrisma(rootPath);
            if (prismaConfig) {
                detectedORMs.push(prismaConfig);
            }

            // Check for TypeORM
            const typeormConfig = await this.detectTypeORM(rootPath);
            if (typeormConfig) {
                detectedORMs.push(typeormConfig);
            }

            // Check for Sequelize
            const sequelizeConfig = await this.detectSequelize(rootPath);
            if (sequelizeConfig) {
                detectedORMs.push(sequelizeConfig);
            }

            // Check for Knex
            const knexConfig = await this.detectKnex(rootPath);
            if (knexConfig) {
                detectedORMs.push(knexConfig);
            }

            // Check for Rails
            const railsConfig = await this.detectRails(rootPath);
            if (railsConfig) {
                detectedORMs.push(railsConfig);
            }

            // Check for Laravel
            const laravelConfig = await this.detectLaravel(rootPath);
            if (laravelConfig) {
                detectedORMs.push(laravelConfig);
            }
        }

        return detectedORMs;
    }

    /**
     * Detect Django by looking for manage.py
     */
    private async detectDjango(rootPath: string): Promise<ORMConfig | null> {
        const managePyPath = await this.findFile(rootPath, 'manage.py');
        if (managePyPath) {
            return {
                type: 'django',
                name: 'Django',
                icon: 'symbol-class',
                detected: true,
                configPath: managePyPath,
                projectRoot: path.dirname(managePyPath)
            };
        }
        return null;
    }

    /**
     * Detect Prisma by looking for schema.prisma
     */
    private async detectPrisma(rootPath: string): Promise<ORMConfig | null> {
        const schemaPath = await this.findFile(rootPath, 'schema.prisma');
        if (schemaPath) {
            return {
                type: 'prisma',
                name: 'Prisma',
                icon: 'symbol-interface',
                detected: true,
                configPath: schemaPath,
                projectRoot: path.dirname(schemaPath)
            };
        }
        return null;
    }

    /**
     * Detect TypeORM by checking package.json or ormconfig
     */
    private async detectTypeORM(rootPath: string): Promise<ORMConfig | null> {
        // Check for ormconfig files
        const configFiles = ['ormconfig.json', 'ormconfig.js', 'ormconfig.ts'];
        for (const file of configFiles) {
            const configPath = await this.findFile(rootPath, file);
            if (configPath) {
                return {
                    type: 'typeorm',
                    name: 'TypeORM',
                    icon: 'symbol-property',
                    detected: true,
                    configPath,
                    projectRoot: path.dirname(configPath)
                };
            }
        }

        // Check package.json for typeorm dependency
        const packageJson = await this.readPackageJson(rootPath);
        if (packageJson && this.hasDependency(packageJson, 'typeorm')) {
            return {
                type: 'typeorm',
                name: 'TypeORM',
                icon: 'symbol-property',
                detected: true,
                projectRoot: rootPath
            };
        }

        return null;
    }

    /**
     * Detect Sequelize by checking package.json
     */
    private async detectSequelize(rootPath: string): Promise<ORMConfig | null> {
        const packageJson = await this.readPackageJson(rootPath);
        if (packageJson && this.hasDependency(packageJson, 'sequelize')) {
            return {
                type: 'sequelize',
                name: 'Sequelize',
                icon: 'symbol-method',
                detected: true,
                projectRoot: rootPath
            };
        }
        return null;
    }

    /**
     * Detect Knex by checking package.json and knexfile
     */
    private async detectKnex(rootPath: string): Promise<ORMConfig | null> {
        const knexfilePath = await this.findFile(rootPath, 'knexfile.js') || 
                             await this.findFile(rootPath, 'knexfile.ts');
        
        if (knexfilePath) {
            return {
                type: 'knex',
                name: 'Knex',
                icon: 'symbol-variable',
                detected: true,
                configPath: knexfilePath,
                projectRoot: path.dirname(knexfilePath)
            };
        }

        const packageJson = await this.readPackageJson(rootPath);
        if (packageJson && this.hasDependency(packageJson, 'knex')) {
            return {
                type: 'knex',
                name: 'Knex',
                icon: 'symbol-variable',
                detected: true,
                projectRoot: rootPath
            };
        }

        return null;
    }

    /**
     * Detect Rails by looking for Gemfile with rails
     */
    private async detectRails(rootPath: string): Promise<ORMConfig | null> {
        const gemfilePath = await this.findFile(rootPath, 'Gemfile');
        if (gemfilePath) {
            try {
                const content = await fs.promises.readFile(gemfilePath, 'utf8');
                if (content.includes('rails') || content.includes('activerecord')) {
                    return {
                        type: 'rails',
                        name: 'Rails ActiveRecord',
                        icon: 'ruby',
                        detected: true,
                        configPath: gemfilePath,
                        projectRoot: path.dirname(gemfilePath)
                    };
                }
            } catch {
                // Ignore
            }
        }
        return null;
    }

    /**
     * Detect Laravel by looking for composer.json with laravel
     */
    private async detectLaravel(rootPath: string): Promise<ORMConfig | null> {
        const composerPath = await this.findFile(rootPath, 'composer.json');
        if (composerPath) {
            try {
                const content = await fs.promises.readFile(composerPath, 'utf8');
                const composer = JSON.parse(content);
                if (composer.require && 
                    (composer.require['laravel/framework'] || composer.require['illuminate/database'])) {
                    return {
                        type: 'laravel',
                        name: 'Laravel Eloquent',
                        icon: 'symbol-namespace',
                        detected: true,
                        configPath: composerPath,
                        projectRoot: path.dirname(composerPath)
                    };
                }
            } catch {
                // Ignore
            }
        }
        return null;
    }

    /**
     * Find a file by searching workspace using glob pattern
     */
    private async findFile(startPath: string, fileName: string): Promise<string | null> {
        try {
            // First check in the start path
            const directPath = path.join(startPath, fileName);
            try {
                await fs.promises.access(directPath);
                return directPath;
            } catch {
                // Not found directly, search workspace
            }

            // Search entire workspace
            const pattern = `**/${fileName}`;
            const files = await vscode.workspace.findFiles(
                pattern,
                '{**/node_modules/**,**/venv/**,**/.venv/**,**/env/**,**/.env/**,**/dist/**,**/build/**}',
                1 // Only need first match
            );

            if (files.length > 0) {
                return files[0].fsPath;
            }

            return null;
        } catch (error) {
            console.error(`Error finding file ${fileName}:`, error);
            return null;
        }
    }

    /**
     * Read and parse package.json
     */
    private async readPackageJson(rootPath: string): Promise<any | null> {
        try {
            const packagePath = path.join(rootPath, 'package.json');
            const content = await fs.promises.readFile(packagePath, 'utf8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    /**
     * Check if package.json has a dependency
     */
    private hasDependency(packageJson: any, depName: string): boolean {
        return !!(
            (packageJson.dependencies && packageJson.dependencies[depName]) ||
            (packageJson.devDependencies && packageJson.devDependencies[depName])
        );
    }
}

