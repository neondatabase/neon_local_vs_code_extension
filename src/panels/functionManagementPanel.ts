import * as vscode from 'vscode';
import { SqlQueryService } from '../services/sqlQuery.service';
import { StateService } from '../services/state.service';

export interface FunctionDefinition {
    schema: string;
    functionName: string;
    parameters: FunctionParameter[];
    returnType: string;
    language: string;
    body: string;
    isVolatile: boolean;
    securityDefiner: boolean;
    replaceIfExists: boolean;
}

export interface FunctionParameter {
    name: string;
    type: string;
    mode: 'IN' | 'OUT' | 'INOUT';
    defaultValue?: string;
}

export class FunctionManagementPanel {
    private static extractErrorMessage(error: any): string {
        // Handle PostgreSQL error objects
        if (error && typeof error === 'object' && 'message' in error) {
            return error.message;
        }
        // Handle Error instances
        if (error instanceof Error) {
            return error.message;
        }
        // Handle string errors
        if (typeof error === 'string') {
            return error;
        }
        // Fallback: try to stringify
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    public static currentPanels = new Map<string, vscode.WebviewPanel>();

    /**
     * Create a new function/procedure
     */
    public static async createFunction(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        database?: string
    ): Promise<void> {
        const key = `create_func_${database || 'default'}.${schema}`;
        
        if (FunctionManagementPanel.currentPanels.has(key)) {
            FunctionManagementPanel.currentPanels.get(key)!.reveal();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'createFunction',
            `Create Function: ${schema}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [context.extensionUri]
            }
        );

        FunctionManagementPanel.currentPanels.set(key, panel);

        panel.onDidDispose(() => {
            FunctionManagementPanel.currentPanels.delete(key);
        });

        const initialData = {
            schema
        };

        panel.webview.html = FunctionManagementPanel.getWebviewContent(context, panel, initialData);

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'createFunction':
                    await FunctionManagementPanel.executeCreateFunction(
                        context,
                        stateService,
                        message.funcDef,
                        database,
                        panel
                    );
                    break;
                case 'previewSql':
                    const sql = FunctionManagementPanel.generateCreateFunctionSql(message.funcDef);
                    panel.webview.postMessage({ command: 'sqlPreview', sql });
                    break;
                case 'cancel':
                    panel.dispose();
                    break;
            }
        });
    }

    /**
     * Quote a PostgreSQL identifier to preserve case and handle special characters
     */
    private static quoteIdentifier(identifier: string): string {
        // Escape any double quotes by doubling them
        const escaped = identifier.replace(/"/g, '""');
        // Wrap in double quotes
        return `"${escaped}"`;
    }

    /**
     * Drop a function
     */
    public static async dropFunction(
        context: vscode.ExtensionContext,
        stateService: StateService,
        schema: string,
        functionName: string,
        cascade: boolean = false,
        database?: string
    ): Promise<void> {
        try {
            const cascadeStr = cascade ? ' CASCADE' : ' RESTRICT';
            const sql = `DROP FUNCTION ${this.quoteIdentifier(schema)}.${this.quoteIdentifier(functionName)}${cascadeStr};`;
            
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Function "${functionName}" dropped successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            vscode.window.showErrorMessage(`Failed to drop function: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Execute create/update function
     */
    private static async executeCreateFunction(
        context: vscode.ExtensionContext,
        stateService: StateService,
        funcDef: FunctionDefinition,
        database: string | undefined,
        panel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const sql = FunctionManagementPanel.generateCreateFunctionSql(funcDef);
            const sqlService = new SqlQueryService(stateService, context);
            await sqlService.executeQuery(sql, database);

            vscode.window.showInformationMessage(`Function "${funcDef.functionName}" created successfully!`);
            await vscode.commands.executeCommand('neonLocal.schema.refresh');
            panel.dispose();
            
        } catch (error) {
            // Improved error handling to extract meaningful error messages
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (typeof error === 'object' && error !== null) {
                // Handle PostgreSQL error objects
                if ('message' in error && typeof error.message === 'string') {
                    errorMessage = error.message;
                } else {
                    errorMessage = JSON.stringify(error);
                }
            } else {
                errorMessage = String(error);
            }
            
            panel.webview.postMessage({
                command: 'error',
                error: errorMessage
            });
        }
    }

    /**
     * Generate CREATE FUNCTION SQL
     */
    private static generateCreateFunctionSql(funcDef: FunctionDefinition): string {
        const {
            schema,
            functionName,
            parameters,
            returnType,
            language,
            body,
            isVolatile,
            securityDefiner,
            replaceIfExists
        } = funcDef;

        let sql = replaceIfExists ? 'CREATE OR REPLACE FUNCTION ' : 'CREATE FUNCTION ';
        sql += `${schema}.${functionName}(`;
        
        // Add parameters (filter out params without type)
        if (parameters && parameters.length > 0) {
            const validParams = parameters.filter(param => param.type && param.type.trim() !== '');
            if (validParams.length > 0) {
                sql += validParams.map(param => {
                    let paramStr = '';
                    if (param.mode && param.mode !== 'IN') {
                        paramStr += param.mode + ' ';
                    }
                    if (param.name) {
                        paramStr += param.name + ' ';
                    }
                    paramStr += param.type;
                    if (param.defaultValue) {
                        paramStr += ' DEFAULT ' + param.defaultValue;
                    }
                    return paramStr;
                }).join(', ');
            }
        }
        
        sql += ')\n';
        sql += `RETURNS ${returnType}\n`;
        sql += `LANGUAGE ${language}\n`;
        
        // Add volatility
        if (isVolatile) {
            sql += 'VOLATILE\n';
        } else {
            sql += 'STABLE\n';
        }
        
        // Add security
        if (securityDefiner) {
            sql += 'SECURITY DEFINER\n';
        }
        
        sql += 'AS $$\n';
        // Wrap body in BEGIN...END block
        sql += 'BEGIN\n';
        const trimmedBody = body.trim();
        sql += trimmedBody;
        // Ensure body ends with semicolon (required in PL/pgSQL)
        if (!trimmedBody.endsWith(';')) {
            sql += ';';
        }
        sql += '\nEND;\n';
        sql += '$$;';
        
        return sql;
    }

    /**
     * Get webview content for React components (Create Function)
     */
    private static getWebviewContent(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel,
        initialData: any
    ): string {
        const scriptUri = panel.webview.asWebviewUri(
            vscode.Uri.joinPath(context.extensionUri, 'dist', 'createFunction.js')
        );

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Function</title>
    <style>
        body { 
            margin: 0; 
            padding: 0; 
            height: 100vh; 
            overflow: auto; 
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        window.initialData = ${JSON.stringify(initialData)};
    </script>
    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
