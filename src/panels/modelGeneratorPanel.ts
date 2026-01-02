import * as vscode from 'vscode';
import { StateService } from '../services/state.service';
import { SchemaService } from '../services/schema.service';
import { ORMDetectorService, ORMType } from '../services/orms_and_migrations/orm.detector.service';

export class ModelGeneratorPanel {
    /**
     * Generate model/entity code from database table
     */
    public static async generateModelFromTable(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schemaService: SchemaService,
        schema: string,
        tableName: string,
        database?: string
    ): Promise<void> {
        try {
            // Detect ORMs in project
            const ormDetector = new ORMDetectorService();
            const detectedORMs = await ormDetector.detectORMs();

            if (detectedORMs.length === 0) {
                vscode.window.showWarningMessage(
                    'No ORMs detected in project. Please install Django, Prisma, TypeORM, Sequelize, or another supported ORM.'
                );
                return;
            }

            // Let user pick ORM if multiple detected
            let selectedORM: ORMType;
            if (detectedORMs.length === 1) {
                selectedORM = detectedORMs[0].type;
            } else {
                const picked = await vscode.window.showQuickPick(
                    detectedORMs.map(orm => ({
                        label: orm.name,
                        description: orm.projectRoot,
                        ormType: orm.type
                    })),
                    {
                        placeHolder: 'Select ORM to generate code for'
                    }
                );

                if (!picked) {
                    return;
                }

                selectedORM = picked.ormType;
            }

            // Get table columns
            const viewData = await stateService.getViewData();
            const targetDb = database || viewData.selectedDatabase;
            const columns = await schemaService.getColumns(schema, tableName, targetDb);

            // Generate code based on ORM
            const code = await ModelGeneratorPanel.generateCode(
                selectedORM,
                schema,
                tableName,
                columns
            );

            // Create and show document with generated code
            const language = ModelGeneratorPanel.getLanguageForORM(selectedORM);
            const fileName = ModelGeneratorPanel.getFileNameForORM(selectedORM, tableName);

            const doc = await vscode.workspace.openTextDocument({
                content: code,
                language
            });

            await vscode.window.showTextDocument(doc);

            vscode.window.showInformationMessage(
                `Generated ${selectedORM} model for ${tableName}. Save as ${fileName}`
            );

        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to generate model: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Generate code for specific ORM
     */
    private static async generateCode(
        ormType: ORMType,
        schema: string,
        tableName: string,
        columns: any[]
    ): Promise<string> {
        switch (ormType) {
            case 'django':
                return ModelGeneratorPanel.generateDjangoModel(tableName, columns);
            case 'prisma':
                return ModelGeneratorPanel.generatePrismaModel(tableName, columns);
            case 'typeorm':
                return ModelGeneratorPanel.generateTypeORMEntity(tableName, columns);
            case 'sequelize':
                return ModelGeneratorPanel.generateSequelizeModel(tableName, columns);
            default:
                return ModelGeneratorPanel.generateGenericSQL(schema, tableName, columns);
        }
    }

    /**
     * Generate Django model
     */
    private static generateDjangoModel(tableName: string, columns: any[]): string {
        const className = ModelGeneratorPanel.toPascalCase(tableName);
        let code = `from django.db import models\n\n`;
        code += `class ${className}(models.Model):\n`;

        for (const col of columns) {
            const fieldType = ModelGeneratorPanel.djangoTypeMapping(col.type);
            const options: string[] = [];

            if (col.maxLength) {
                options.push(`max_length=${col.maxLength}`);
            }
            if (col.nullable) {
                options.push('null=True', 'blank=True');
            }
            if (col.default) {
                options.push(`default=${col.default}`);
            }

            const optionsStr = options.length > 0 ? `, ${options.join(', ')}` : '';
            code += `    ${col.name} = models.${fieldType}(${optionsStr})\n`;
        }

        code += `\n    class Meta:\n`;
        code += `        db_table = '${tableName}'\n`;

        return code;
    }

    /**
     * Generate Prisma model
     */
    private static generatePrismaModel(tableName: string, columns: any[]): string {
        const modelName = ModelGeneratorPanel.toPascalCase(tableName);
        let code = `model ${modelName} {\n`;

        for (const col of columns) {
            const fieldType = ModelGeneratorPanel.prismaTypeMapping(col.type);
            const modifiers: string[] = [];

            if (col.isPrimaryKey) {
                modifiers.push('@id');
            }
            if (col.isUnique) {
                modifiers.push('@unique');
            }
            if (col.default) {
                modifiers.push(`@default(${col.default})`);
            }
            if (!col.nullable && !col.isPrimaryKey) {
                // Prisma requires ! for non-nullable
            } else if (col.nullable) {
                modifiers.push('?');
            }

            const modifiersStr = modifiers.length > 0 ? ` ${modifiers.join(' ')}` : '';
            code += `  ${col.name} ${fieldType}${col.nullable ? '?' : ''}${modifiersStr}\n`;
        }

        code += `\n  @@map("${tableName}")\n`;
        code += `}\n`;

        return code;
    }

    /**
     * Generate TypeORM entity
     */
    private static generateTypeORMEntity(tableName: string, columns: any[]): string {
        const className = ModelGeneratorPanel.toPascalCase(tableName);
        let code = `import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';\n\n`;
        code += `@Entity('${tableName}')\n`;
        code += `export class ${className} {\n`;

        for (const col of columns) {
            if (col.isPrimaryKey && col.type.includes('serial')) {
                code += `  @PrimaryGeneratedColumn()\n`;
            } else if (col.isPrimaryKey) {
                code += `  @PrimaryColumn()\n`;
            } else {
                const options: string[] = [];
                if (col.nullable) {
                    options.push('nullable: true');
                }
                if (col.default) {
                    options.push(`default: ${col.default}`);
                }
                const optionsStr = options.length > 0 ? `{ ${options.join(', ')} }` : '';
                code += `  @Column(${optionsStr})\n`;
            }

            const tsType = ModelGeneratorPanel.typeScriptTypeMapping(col.type);
            code += `  ${col.name}${col.nullable ? '?' : ''}: ${tsType};\n\n`;
        }

        code += `}\n`;

        return code;
    }

    /**
     * Generate Sequelize model
     */
    private static generateSequelizeModel(tableName: string, columns: any[]): string {
        const className = ModelGeneratorPanel.toPascalCase(tableName);
        let code = `const { DataTypes } = require('sequelize');\n\n`;
        code += `module.exports = (sequelize) => {\n`;
        code += `  const ${className} = sequelize.define('${className}', {\n`;

        for (const col of columns) {
            const fieldType = ModelGeneratorPanel.sequelizeTypeMapping(col.type);
            code += `    ${col.name}: {\n`;
            code += `      type: DataTypes.${fieldType},\n`;

            if (col.isPrimaryKey) {
                code += `      primaryKey: true,\n`;
            }
            if (col.type.includes('serial')) {
                code += `      autoIncrement: true,\n`;
            }
            if (!col.nullable) {
                code += `      allowNull: false,\n`;
            }
            if (col.default) {
                code += `      defaultValue: ${col.default},\n`;
            }

            code += `    },\n`;
        }

        code += `  }, {\n`;
        code += `    tableName: '${tableName}',\n`;
        code += `  });\n\n`;
        code += `  return ${className};\n`;
        code += `};\n`;

        return code;
    }

    /**
     * Generate generic SQL CREATE TABLE
     */
    private static generateGenericSQL(schema: string, tableName: string, columns: any[]): string {
        let code = `-- SQL CREATE TABLE statement\n\n`;
        code += `CREATE TABLE ${schema}.${tableName} (\n`;

        const columnDefs = columns.map(col => {
            let def = `  ${col.name} ${col.type}`;
            if (!col.nullable) {
                def += ' NOT NULL';
            }
            if (col.default) {
                def += ` DEFAULT ${col.default}`;
            }
            return def;
        });

        code += columnDefs.join(',\n');
        code += `\n);\n`;

        return code;
    }

    /**
     * Type mapping helpers
     */
    private static djangoTypeMapping(pgType: string): string {
        const mapping: { [key: string]: string } = {
            'integer': 'IntegerField()',
            'bigint': 'BigIntegerField()',
            'smallint': 'SmallIntegerField()',
            'serial': 'AutoField()',
            'bigserial': 'BigAutoField()',
            'varchar': 'CharField',
            'text': 'TextField()',
            'boolean': 'BooleanField()',
            'date': 'DateField()',
            'timestamp': 'DateTimeField()',
            'timestamptz': 'DateTimeField()',
            'time': 'TimeField()',
            'json': 'JSONField()',
            'jsonb': 'JSONField()',
            'uuid': 'UUIDField()',
            'decimal': 'DecimalField()',
            'float': 'FloatField()',
            'double': 'FloatField()',
        };

        for (const [key, value] of Object.entries(mapping)) {
            if (pgType.toLowerCase().includes(key)) {
                return value;
            }
        }

        return 'CharField';
    }

    private static prismaTypeMapping(pgType: string): string {
        const mapping: { [key: string]: string } = {
            'integer': 'Int',
            'bigint': 'BigInt',
            'smallint': 'Int',
            'serial': 'Int',
            'bigserial': 'BigInt',
            'varchar': 'String',
            'text': 'String',
            'boolean': 'Boolean',
            'date': 'DateTime',
            'timestamp': 'DateTime',
            'time': 'DateTime',
            'json': 'Json',
            'jsonb': 'Json',
            'uuid': 'String',
            'decimal': 'Decimal',
            'float': 'Float',
            'double': 'Float',
        };

        for (const [key, value] of Object.entries(mapping)) {
            if (pgType.toLowerCase().includes(key)) {
                return value;
            }
        }

        return 'String';
    }

    private static typeScriptTypeMapping(pgType: string): string {
        const mapping: { [key: string]: string } = {
            'integer': 'number',
            'bigint': 'number',
            'smallint': 'number',
            'serial': 'number',
            'varchar': 'string',
            'text': 'string',
            'boolean': 'boolean',
            'date': 'Date',
            'timestamp': 'Date',
            'time': 'Date',
            'json': 'object',
            'jsonb': 'object',
            'uuid': 'string',
            'decimal': 'number',
            'float': 'number',
        };

        for (const [key, value] of Object.entries(mapping)) {
            if (pgType.toLowerCase().includes(key)) {
                return value;
            }
        }

        return 'string';
    }

    private static sequelizeTypeMapping(pgType: string): string {
        const mapping: { [key: string]: string } = {
            'integer': 'INTEGER',
            'bigint': 'BIGINT',
            'smallint': 'SMALLINT',
            'serial': 'INTEGER',
            'varchar': 'STRING',
            'text': 'TEXT',
            'boolean': 'BOOLEAN',
            'date': 'DATEONLY',
            'timestamp': 'DATE',
            'time': 'TIME',
            'json': 'JSON',
            'jsonb': 'JSONB',
            'uuid': 'UUID',
            'decimal': 'DECIMAL',
            'float': 'FLOAT',
            'double': 'DOUBLE',
        };

        for (const [key, value] of Object.entries(mapping)) {
            if (pgType.toLowerCase().includes(key)) {
                return value;
            }
        }

        return 'STRING';
    }

    /**
     * Convert snake_case to PascalCase
     */
    private static toPascalCase(str: string): string {
        return str
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join('');
    }

    /**
     * Get language for ORM
     */
    private static getLanguageForORM(ormType: ORMType): string {
        const mapping: { [key: string]: string } = {
            'django': 'python',
            'prisma': 'prisma',
            'typeorm': 'typescript',
            'sequelize': 'javascript',
            'knex': 'javascript',
            'rails': 'ruby',
            'laravel': 'php',
        };

        return mapping[ormType] || 'sql';
    }

    /**
     * Get suggested filename for ORM
     */
    private static getFileNameForORM(ormType: ORMType, tableName: string): string {
        const className = ModelGeneratorPanel.toPascalCase(tableName);

        const mapping: { [key: string]: string } = {
            'django': 'models.py',
            'prisma': 'schema.prisma',
            'typeorm': `${className}.entity.ts`,
            'sequelize': `${tableName}.model.js`,
            'knex': `${tableName}.js`,
            'rails': `${tableName}.rb`,
            'laravel': `${className}.php`,
        };

        return mapping[ormType] || `${tableName}.sql`;
    }
}

