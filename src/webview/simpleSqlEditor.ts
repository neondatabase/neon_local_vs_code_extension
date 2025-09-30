import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';
import { defaultKeymap } from '@codemirror/commands';
import { linter, lintGutter, setDiagnostics, Diagnostic } from '@codemirror/lint';
import { autocompletion, completionKeymap, CompletionContext, completionStatus, acceptCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';

/**
 * SQL Editor with syntax highlighting, linting, and autocompletion
 */
export class SimpleSqlEditor {
    private editor: EditorView;
    private container: HTMLElement;
    private vscode: any;
    private onExecuteCallback?: (query: string) => void;
    private schemaInfo: any = null; // Will hold database schema for suggestions

    constructor(container: HTMLElement, vscode: any) {
        console.log('SimpleSqlEditor constructor called');
        console.log('Container:', container);
        console.log('VSCode API:', vscode);
        
        this.container = container;
        this.vscode = vscode;
        this.initializeEditor();
    }

    /**
     * Validate SQL before execution - now uses CodeMirror's native linting
     * This method is kept for compatibility but delegates to CodeMirror
     */
    public validateSql(query: string): { isValid: boolean; errors: string[] } {
        console.log('🔍 validateSql() called - now using CodeMirror native linting');
        
        // Simply return valid - CodeMirror handles real-time linting automatically
        // The linter will show errors as you type, no need for manual validation
        const trimmedQuery = query.trim();
        
        if (!trimmedQuery || trimmedQuery.split('\n').every(line => 
            line.trim() === '' || line.trim().startsWith('--')
        )) {
            return { isValid: false, errors: ['Query is empty or contains only comments'] };
        }
        
        // CodeMirror's linter handles syntax errors automatically
        console.log('🔍 Using CodeMirror native linting - allowing execution');
        return { isValid: true, errors: [] };
    }

    /**
     * Basic SQL validation when parser is not available
     */
    private basicSqlValidation(doc: string): string[] {
        console.log('🔍 basicSqlValidation() called with doc:', doc.substring(0, 50) + '...');
        const errors: string[] = [];
        const lines = doc.split('\n');
        
        // Add comprehensive misspelling detection
        const commonMisspellings = [
            { wrong: 'selct', correct: 'SELECT', length: 5 },
            { wrong: 'slect', correct: 'SELECT', length: 5 },
            { wrong: 'selec', correct: 'SELECT', length: 5 },
            { wrong: 'selet', correct: 'SELECT', length: 5 },
            { wrong: 'form', correct: 'FROM', length: 4 },
            { wrong: 'wher', correct: 'WHERE', length: 4 },
            { wrong: 'whre', correct: 'WHERE', length: 4 },
            { wrong: 'oder', correct: 'ORDER', length: 4 },
            { wrong: 'gropu', correct: 'GROUP', length: 5 },
            { wrong: 'grup', correct: 'GROUP', length: 4 }
        ];

        console.log('🔍 Checking for misspellings...');
        for (const misspelling of commonMisspellings) {
            const regex = new RegExp(`\\b${misspelling.wrong}\\b`, 'gi');
            console.log(`🔍 Testing regex /${misspelling.wrong}/gi against doc...`);
            if (regex.test(doc)) {
                const errorMsg = `Misspelled ${misspelling.correct} keyword: found "${misspelling.wrong}"`;
                console.log('🔍 ❌ Found misspelling:', errorMsg);
                errors.push(errorMsg);
            }
        }
        
        lines.forEach((line, index) => {
            const trimmedLine = line.trim().toLowerCase();
            if (trimmedLine && !trimmedLine.startsWith('--')) {
                // Check for basic SQL structure issues
                if (trimmedLine.includes('select') && !trimmedLine.includes('from') && 
                    !doc.toLowerCase().includes('from')) {
                    errors.push('SELECT statement missing FROM clause');
                }
            }
        });

        return errors;
    }

    /**
     * Additional SQL validations for common issues
     */
    private additionalSqlValidation(doc: string): string[] {
        const errors: string[] = [];
        const lines = doc.split('\n');
        
        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('--')) {
                // Check for trailing commas
                if (trimmedLine.endsWith(',')) {
                    errors.push('Trailing comma detected - check if this is intentional');
                }
                
                // Check for potential SQL injection patterns (basic)
                const lowerLine = trimmedLine.toLowerCase();
                if (lowerLine.includes('drop table') || lowerLine.includes('delete from')) {
                    errors.push('Potentially destructive SQL operation detected - use with caution');
                }
            }
        });

        return errors;
    }

    /**
     * SQL Autocompletion function
     */
    private sqlCompletions = (context: CompletionContext) => {
        const word = context.matchBefore(/\w*/);
        if (!word) return null;

        const options: any[] = [];

        // SQL Keywords
        const sqlKeywords = [
            'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER',
            'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'IS', 'NULL',
            'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE',
            'ALTER', 'DROP', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'PRIMARY', 'KEY',
            'FOREIGN', 'REFERENCES', 'UNIQUE', 'CHECK', 'DEFAULT', 'AUTO_INCREMENT',
            'ORDER', 'BY', 'ASC', 'DESC', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
            'UNION', 'ALL', 'DISTINCT', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
            'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CONCAT', 'SUBSTRING',
            'UPPER', 'LOWER', 'TRIM', 'LENGTH', 'NOW', 'CURRENT_DATE', 'CURRENT_TIME'
        ];

        // Add SQL keywords to suggestions
        sqlKeywords.forEach(keyword => {
            if (keyword.toLowerCase().startsWith(word.text.toLowerCase())) {
                options.push({
                    label: keyword,
                    type: 'keyword',
                    info: `SQL keyword: ${keyword}`,
                    boost: keyword.length === word.text.length ? 2 : 1
                });
            }
        });

        // Add common column patterns/suggestions
        const commonColumns = [
            'id', 'user_id', 'created_at', 'updated_at', 'name', 'email', 'status', 
            'active', 'deleted_at', 'description', 'title', 'type', 'value', 'count'
        ];
        
        commonColumns.forEach(col => {
            if (col.toLowerCase().startsWith(word.text.toLowerCase())) {
                options.push({
                    label: col,
                    type: 'variable',
                    info: `Common column: ${col}`,
                    boost: 0.5 // Lower priority than actual schema columns
                });
            }
        });

        // Add schema-based suggestions if available
        if (this.schemaInfo) {
            // Add table names
            if (this.schemaInfo.tables && Array.isArray(this.schemaInfo.tables)) {
                this.schemaInfo.tables.forEach((table: any) => {
                    if (table && table.name && typeof table.name === 'string') {
                        if (table.name.toLowerCase().startsWith(word.text.toLowerCase())) {
                            options.push({
                                label: table.name,
                                type: 'property',
                                info: `Table: ${table.name}`,
                                boost: 3
                            });
                        }
                    }
                });
            }

            // Add intelligent column name suggestions
            if (this.schemaInfo.columns && Array.isArray(this.schemaInfo.columns)) {
                const queryText = this.editor.state.doc.toString().toLowerCase();
                const tablesInQuery = this.extractTablesFromQuery(queryText);
                
                console.log('🔍 Tables found in query:', tablesInQuery);
                
                this.schemaInfo.columns.forEach((column: any) => {
                    if (column && column.name && typeof column.name === 'string') {
                        const columnNameLower = column.name.toLowerCase();
                        const wordTextLower = word.text.toLowerCase();
                        
                        // Check if column name matches the typed text
                        const exactMatch = columnNameLower === wordTextLower;
                        const startsWithMatch = columnNameLower.startsWith(wordTextLower);
                        const containsMatch = columnNameLower.includes(wordTextLower);
                        
                        if (exactMatch || startsWithMatch || (wordTextLower.length > 2 && containsMatch)) {
                            // Determine boost based on context
                            let boost = 1;
                            let contextInfo = '';
                            
                            // Higher boost if column is from a table mentioned in the query
                            if (tablesInQuery.includes(column.table?.toLowerCase())) {
                                boost = 4; // High priority for contextually relevant columns
                                contextInfo = ` (from ${column.table})`;
                            } else if (column.table) {
                                boost = 2; // Lower priority for other table columns
                                contextInfo = ` (from ${column.table})`;
                            }
                            
                            // Extra boost for exact matches
                            if (exactMatch) boost += 2;
                            else if (startsWithMatch) boost += 1;
                            
                            options.push({
                                label: column.name,
                                type: 'property',
                                info: `Column: ${column.name} (${column.type || 'unknown'})${contextInfo}`,
                                boost: boost,
                                detail: column.table ? `${column.table}.${column.name}` : column.name
                            });
                        }
                    }
                });
            }
        }

        return {
            from: word.from,
            options: options
        };
    };

    /**
     * Extract table names from SQL query for context-aware autocompletion
     */
    private extractTablesFromQuery(queryText: string): string[] {
        const tables: string[] = [];
        
        // Simple regex patterns to find table names in common SQL patterns
        const patterns = [
            // FROM table_name
            /from\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/gi,
            // JOIN table_name
            /join\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/gi,
            // UPDATE table_name
            /update\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/gi,
            // INSERT INTO table_name
            /insert\s+into\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/gi,
            // DELETE FROM table_name
            /delete\s+from\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)/gi
        ];
        
        patterns.forEach(pattern => {
            let match;
            while ((match = pattern.exec(queryText)) !== null) {
                const tableName = match[1].toLowerCase();
                // Extract just the table name (remove schema prefix if present)
                const tableNameParts = tableName.split('.');
                const actualTableName = tableNameParts[tableNameParts.length - 1];
                
                if (!tables.includes(actualTableName)) {
                    tables.push(actualTableName);
                }
            }
        });
        
        return tables;
    }

    /**
     * Check if a word is likely a misspelling of a target word
     */
    private isLikelyMisspelling(word: string, target: string): boolean {
        // Simple heuristics for detecting misspellings
        if (word.length < 3 || target.length < 3) return false;
        
        // Check if it starts with the same 2-3 characters
        const prefixMatch = word.substring(0, 3) === target.substring(0, 3) || 
                           word.substring(0, 2) === target.substring(0, 2);
        
        // Check character similarity (Levenshtein-like)
        const similarity = this.calculateSimilarity(word, target);
        
        return prefixMatch && similarity > 0.6;
    }

    /**
     * Calculate similarity between two strings (0-1, where 1 is identical)
     */
    private calculateSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(str1, str2);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private levenshteinDistance(str1: string, str2: string): number {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * Create a native CodeMirror SQL linter that uses the syntax tree
     */
    private createSqlLinter() {
        return linter((view) => {
            const diagnostics: Diagnostic[] = [];
            const doc = view.state.doc;
            const tree = syntaxTree(view.state);
            
            // Check for syntax tree errors (parse errors)
            tree.iterate({
                enter: (node) => {
                    // Look for error nodes in the syntax tree
                    if (node.type.isError || node.name === '⚠') {
                        const from = node.from;
                        const to = node.to;
                        const text = doc.sliceString(from, to);
                        
                        diagnostics.push({
                            from,
                            to,
                            severity: 'error',
                            message: `Syntax error: unexpected "${text}"`,
                            source: 'sql-parser'
                        });
                    }
                    
                    // Check for incomplete statements
                    if (node.name === 'Statement' && node.to === node.from) {
                        diagnostics.push({
                            from: node.from,
                            to: Math.min(node.from + 10, doc.length),
                            severity: 'error',
                            message: 'Incomplete SQL statement',
                            source: 'sql-parser'
                        });
                    }
                }
            });
            
            // Additional checks for common SQL errors
            const text = doc.toString();
            const lines = text.split('\n');
            
            lines.forEach((line, lineIndex) => {
                const lineStart = lineIndex === 0 ? 0 : doc.line(lineIndex + 1).from;
                
                // Check for common misspellings
                const misspellings = [
                    { wrong: /\bSELEC\b/gi, right: 'SELECT' },
                    { wrong: /\bFORM\b/gi, right: 'FROM' },
                    { wrong: /\bWHER\b/gi, right: 'WHERE' },
                    { wrong: /\bLIMvIT\b/gi, right: 'LIMIT' },
                    { wrong: /\bORDER\s+BUY\b/gi, right: 'ORDER BY' },
                    { wrong: /\bGROUP\s+BUY\b/gi, right: 'GROUP BY' },
                    { wrong: /\bJOIN\b/gi, right: 'JOIN' },
                    { wrong: /\bINNER\s+JION\b/gi, right: 'INNER JOIN' },
                    { wrong: /\bLEFT\s+JION\b/gi, right: 'LEFT JOIN' }
                ];
                
                misspellings.forEach(({ wrong, right }) => {
                    let match;
                    while ((match = wrong.exec(line)) !== null) {
                        diagnostics.push({
                            from: lineStart + match.index,
                            to: lineStart + match.index + match[0].length,
                            severity: 'error',
                            message: `Misspelled keyword: "${match[0]}" (did you mean "${right}"?)`,
                            source: 'sql-spellcheck'
                        });
                    }
                });
            });
            
            return diagnostics;
        });
    }

    private initializeEditor(): void {
        console.log('Initializing CodeMirror editor...');
        
        // Detect VS Code theme
        const isDark = document.body.classList.contains('vscode-dark');
        console.log('Is dark theme:', isDark);
        
        // Create editor state with autocompletion and on-demand linting
        const state = EditorState.create({
            doc: '-- Enter your SQL query here\n-- Press Ctrl+Enter to execute\n\n',
            extensions: [
                sql(), // SQL language support
                history(), // Undo/redo functionality
                this.createSqlLinter(), // Native CodeMirror SQL linter
                lintGutter(), // Show lint errors in gutter
                autocompletion({
                    override: [this.sqlCompletions],
                    activateOnTyping: true,
                    maxRenderedOptions: 10
                }), // SQL autocompletion
                isDark ? oneDark : [], // Theme
                EditorView.theme({
                    '.cm-lint-marker': {
                        width: '0.8em',
                        height: '0.8em'
                    },
                    '.cm-diagnostic': {
                        padding: '3px 6px 3px 8px',
                        marginLeft: '-1px',
                        display: 'block',
                        whiteSpace: 'pre-wrap',
                        backgroundColor: 'var(--vscode-inputValidation-errorBackground, #5a1d1d)',
                        color: 'var(--vscode-inputValidation-errorForeground, #f8f8f2)',
                        border: '1px solid var(--vscode-inputValidation-errorBorder, #be1100)',
                        borderRadius: '3px'
                    },
                    '.cm-lintRange-error': {
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'6\' height=\'3\'%3E%3Cpath d=\'m0 3 l2 -2 l1 0 l2 2 l1 0\' stroke=\'%23be1100\' fill=\'none\' stroke-width=\'.7\'/%3E%3C/svg%3E")',
                        backgroundPosition: 'left bottom',
                        backgroundRepeat: 'repeat-x'
                    },
                    '.cm-lintRange-warning': {
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'6\' height=\'3\'%3E%3Cpath d=\'m0 3 l2 -2 l1 0 l2 2 l1 0\' stroke=\'%23ffb000\' fill=\'none\' stroke-width=\'.7\'/%3E%3C/svg%3E")',
                        backgroundPosition: 'left bottom',
                        backgroundRepeat: 'repeat-x'
                    }
                }),
                keymap.of([
                    // Custom Tab behavior for autocompletion
                    {
                        key: 'Tab',
                        run: (view) => {
                            // Check if autocompletion is active
                            const status = completionStatus(view.state);
                            if (status === 'active') {
                                // Accept the current completion with Tab
                                return acceptCompletion(view);
                            }
                            // Otherwise, use normal Tab behavior (indentation)
                            return indentWithTab.run ? indentWithTab.run(view) : false;
                        }
                    },
                    indentWithTab, // Handle Tab key for indentation (fallback)
                    ...defaultKeymap, // Default editor keybindings
                    ...historyKeymap, // Undo/redo keybindings
                    ...searchKeymap, // Search keybindings
                    ...completionKeymap, // Autocompletion keybindings
                    {
                        key: 'Ctrl-Enter',
                        mac: 'Cmd-Enter',
                        run: () => {
                            this.executeQuery();
                            return true;
                        }
                    }
                ]),
                EditorView.theme({
                    '&': {
                        fontSize: '14px',
                        fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Monaco", "Courier New", monospace)'
                    },
                    '.cm-content': {
                        padding: '12px',
                        minHeight: '200px',
                        backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
                        color: isDark ? '#d4d4d4' : '#000000'
                    },
                    '.cm-focused': {
                        outline: 'none'
                    },
                    '.cm-editor': {
                        borderRadius: '4px',
                        border: `1px solid ${isDark ? '#3c3c3c' : '#d1d5da'}`
                    },
                    '.cm-scroller': {
                        fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Monaco", "Courier New", monospace)'
                    },
                    '.cm-lint-marker': {
                        width: '16px',
                        cursor: 'pointer'
                    },
                    '.cm-lint-marker-error': {
                        color: '#ff6b6b',
                        fontWeight: 'bold'
                    },
                    '.cm-lint-marker-warning': {
                        color: '#ffa726',
                        fontWeight: 'bold'
                    },
                    '.cm-lint-marker-info': {
                        color: '#42a5f5',
                        fontWeight: 'bold'
                    },
                    '.cm-diagnostic': {
                        padding: '6px 12px',
                        borderRadius: '4px',
                        fontSize: '13px',
                        lineHeight: '1.4',
                        maxWidth: '400px',
                        wordWrap: 'break-word'
                    },
                    '.cm-diagnostic-error': {
                        backgroundColor: isDark ? '#4a1a1a' : '#ffeaea',
                        borderLeft: '3px solid #ff6b6b',
                        color: isDark ? '#ffcdd2' : '#c62828'
                    },
                    // Line-level error highlighting
                    '.cm-line-error': {
                        backgroundColor: isDark ? 'rgba(255, 68, 68, 0.08)' : 'rgba(255, 68, 68, 0.04)',
                        borderLeft: '3px solid rgba(255, 68, 68, 0.6)',
                        paddingLeft: '8px',
                        marginLeft: '-8px'
                    },
                    '.cm-diagnostic-warning': {
                        backgroundColor: isDark ? '#4a3a1a' : '#fff8e1',
                        borderLeft: '3px solid #ffa726',
                        color: isDark ? '#ffcc80' : '#ef6c00'
                    },
                    '.cm-diagnostic-info': {
                        backgroundColor: isDark ? '#1a2a4a' : '#e3f2fd',
                        borderLeft: '3px solid #42a5f5',
                        color: isDark ? '#90caf9' : '#1565c0'
                    },
                    // Inline error highlighting - more visible
                    '.cm-lintRange-error': {
                        textDecoration: 'underline',
                        textDecorationColor: '#ff4444',
                        textDecorationStyle: 'wavy',
                        textDecorationThickness: '2px',
                        textUnderlineOffset: '2px',
                        backgroundColor: isDark ? 'rgba(255, 68, 68, 0.1)' : 'rgba(255, 68, 68, 0.05)',
                        borderRadius: '2px'
                    },
                    '.cm-lintRange-warning': {
                        textDecoration: 'underline',
                        textDecorationColor: '#ffa726',
                        textDecorationStyle: 'wavy',
                        textUnderlineOffset: '2px'
                    },
                    '.cm-lintRange-info': {
                        textDecoration: 'underline',
                        textDecorationColor: '#42a5f5',
                        textDecorationStyle: 'dotted',
                        textUnderlineOffset: '2px'
                    }
                })
            ]
        });

        console.log('Creating EditorView...');
        console.log('State:', state);
        console.log('Container:', this.container);
        
        // Create the editor view
        try {
            this.editor = new EditorView({
                state,
                parent: this.container
            });
            console.log('EditorView created successfully:', this.editor);
        } catch (error) {
            console.error('Error creating EditorView:', error);
            throw error;
        }

        // Focus the editor by default
        this.editor.focus();

        console.log('Simple SQL Editor initialized');
    }

    /**
     * Execute the query (validation handled in executeQueryWithText)
     */
    private executeQuery(): void {
        console.log('🔍 SimpleSqlEditor.executeQuery() called');
        const query = this.getValue().trim();
        console.log('🔍 Query to execute:', query.substring(0, 100) + (query.length > 100 ? '...' : ''));
        
        if (!query) {
            console.log('🔍 Empty query detected');
            return;
        }

        // Pass to callback (which will handle validation in executeQueryWithText)
        console.log('🔍 Calling onExecuteCallback...');
        if (this.onExecuteCallback) {
            this.onExecuteCallback(query);
        } else {
            console.log('🔍 Using VS Code message fallback');
            // Fallback to VS Code message
            this.vscode.postMessage({
                command: 'executeQuery',
                query: query
            });
        }
    }

    /**
     * Get the current editor content
     */
    public getValue(): string {
        const content = this.editor.state.doc.toString();
        console.log('🔍 getValue() called, raw content:', JSON.stringify(content.substring(0, 100)));
        console.log('🔍 getValue() content length:', content.length);
        console.log('🔍 getValue() first 20 chars:', content.substring(0, 20).split('').map(c => `'${c}'(${c.charCodeAt(0)})`).join(' '));
        return content;
    }

    /**
     * Set the editor content
     */
    public setValue(value: string): void {
        console.log('🔍 setValue() called with value:', JSON.stringify(value.substring(0, 100)));
        console.log('🔍 setValue() value length:', value.length);
        console.log('🔍 setValue() first 20 chars:', value.substring(0, 20).split('').map(c => `'${c}'(${c.charCodeAt(0)})`).join(' '));
        
        this.editor.dispatch({
            changes: {
                from: 0,
                to: this.editor.state.doc.length,
                insert: value
            }
        });
        
        console.log('🔍 setValue() completed, new content:', JSON.stringify(this.editor.state.doc.toString().substring(0, 100)));
    }

    /**
     * Focus the editor
     */
    public focus(): void {
        this.editor.focus();
    }

    /**
     * Set callback for query execution
     */
    public onExecute(callback: (query: string) => void): void {
        this.onExecuteCallback = callback;
    }

    /**
     * Update schema information for better autocompletion
     */
    public updateSchema(schemaInfo: any): void {
        this.schemaInfo = schemaInfo;
        console.log('Schema info updated:', schemaInfo);
    }

    // Manual validation methods removed - CodeMirror handles linting automatically

    /**
     * Insert text at current cursor position
     */
    public insertText(text: string): void {
        const selection = this.editor.state.selection.main;
        this.editor.dispatch({
            changes: {
                from: selection.from,
                to: selection.to,
                insert: text
            },
            selection: {
                anchor: selection.from + text.length
            }
        });
        this.editor.focus();
    }

    /**
     * Highlight a specific line with an error indicator
     */
    public highlightErrorLine(lineNumber: number): void {
        console.log('🔍 Highlighting error line:', lineNumber);
        
        if (lineNumber < 1) {
            console.log('🔍 Invalid line number:', lineNumber);
            return;
        }
        
        try {
            const doc = this.editor.state.doc;
            const totalLines = doc.lines;
            
            // Ensure line number is within bounds
            const targetLine = Math.min(lineNumber, totalLines);
            console.log('🔍 Target line (clamped):', targetLine, 'of', totalLines);
            
            // Get the line object
            const line = doc.line(targetLine);
            console.log('🔍 Line object:', line);
            
            // Create a diagnostic for the entire line with better visibility
            const diagnostic: Diagnostic = {
                from: line.from,
                to: Math.max(line.to, line.from + 1), // Ensure at least 1 character is highlighted
                severity: 'error',
                message: `Syntax error on line ${lineNumber}`,
                source: 'sql-execution-error'
            };
            
            // Apply the diagnostic to highlight the line
            this.editor.dispatch(setDiagnostics(this.editor.state, [diagnostic]));
            
            // Scroll to the error line with animation
            this.editor.dispatch({
                effects: EditorView.scrollIntoView(line.from, { 
                    y: 'center',
                    yMargin: 50 // Add some margin around the line
                })
            });
            
            // Focus the editor to make the highlighting more visible
            this.editor.focus();
            
            console.log('🔍 Error line highlighted successfully');
        } catch (error) {
            console.error('🔍 Error highlighting line:', error);
        }
    }

    /**
     * Clear error line highlighting
     */
    public clearErrorHighlight(): void {
        console.log('🔍 Clearing error highlighting');
        this.editor.dispatch(setDiagnostics(this.editor.state, []));
    }

    /**
     * Destroy the editor
     */
    public destroy(): void {
        if (this.editor) {
            this.editor.destroy();
        }
    }
}

// Export the class globally for use in the webview
if (typeof window !== 'undefined') {
    console.log('Exporting SimpleSqlEditor to window');
    (window as any).SimpleSqlEditor = SimpleSqlEditor;
    console.log('SimpleSqlEditor exported:', (window as any).SimpleSqlEditor);
} else {
    console.log('Window not available, cannot export SimpleSqlEditor');
}

export default SimpleSqlEditor;
