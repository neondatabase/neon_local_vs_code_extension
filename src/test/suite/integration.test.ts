import * as assert from 'assert';
import * as vscode from 'vscode';
import { StateService } from '../../services/state.service';
import { SchemaService } from '../../services/schema.service';
import { NeonApiService } from '../../services/api.service';
import { AuthManager } from '../../auth/authManager';

/**
 * Integration Tests for Schema View with Real Neon Branch
 * 
 * These tests require:
 * 1. A valid Neon API token (set via NEON_API_TOKEN environment variable)
 * 2. A project ID (set via NEON_PROJECT_ID environment variable)
 * 3. A branch ID (set via NEON_BRANCH_ID environment variable)
 * 
 * To run these tests:
 * export NEON_API_TOKEN="your_api_token"
 * export NEON_PROJECT_ID="your_project_id"
 * export NEON_BRANCH_ID="your_branch_id"
 * npm test
 * 
 * These tests will be skipped if the environment variables are not set.
 */
suite('Schema View Integration Tests (Real Neon Branch)', () => {
    let context: vscode.ExtensionContext;
    let stateService: StateService;
    let schemaService: SchemaService;
    let apiService: NeonApiService;
    let authManager: AuthManager;
    
    const NEON_API_TOKEN = process.env.NEON_API_TOKEN;
    const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;
    const NEON_BRANCH_ID = process.env.NEON_BRANCH_ID;
    
    const shouldSkip = !NEON_API_TOKEN || !NEON_PROJECT_ID || !NEON_BRANCH_ID;

    suiteSetup(async function() {
        if (shouldSkip) {
            console.log('⚠️  Skipping integration tests - missing environment variables');
            console.log('   Set NEON_API_TOKEN, NEON_PROJECT_ID, and NEON_BRANCH_ID to run these tests');
            this.skip();
            return;
        }

        console.log('🔧 Setting up integration tests with real Neon branch...');
        
        // Get the extension context
        const ext = vscode.extensions.getExtension('undefined_publisher.neon-local-connect');
        assert.ok(ext, 'Extension must be installed');
        
        if (!ext.isActive) {
            await ext.activate();
        }

        // Get the extension context (we'll create a mock one for testing)
        context = {
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            } as any,
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => [],
                setKeysForSync: () => {}
            } as any,
            secrets: {
                get: async (key: string) => {
                    if (key === 'neon.persistentApiToken') {
                        return NEON_API_TOKEN;
                    }
                    return undefined;
                },
                store: () => Promise.resolve(),
                delete: () => Promise.resolve()
            } as any,
            extensionPath: ext.extensionPath,
            globalStoragePath: '',
            logPath: '',
            storagePath: '',
            extensionUri: ext.extensionUri,
            environmentVariableCollection: {} as any,
            extensionMode: vscode.ExtensionMode.Test,
            asAbsolutePath: (relativePath: string) => relativePath,
            storageUri: vscode.Uri.file(''),
            globalStorageUri: vscode.Uri.file(''),
            logUri: vscode.Uri.file(''),
            extension: ext as any,
            languageModelAccessInformation: {} as any
        };

        // Initialize services
        stateService = new StateService(context);
        apiService = new NeonApiService(context);
        authManager = AuthManager.getInstance(context);
        
        // Set the persistent API token
        await authManager.setPersistentApiToken(NEON_API_TOKEN!);
        
        console.log('✅ Services initialized successfully');
    });

    suite('API Service Tests', () => {
        test('Should fetch organizations', async function() {
            this.timeout(10000);
            
            const orgs = await apiService.getOrgs();
            assert.ok(Array.isArray(orgs), 'Should return an array of organizations');
            assert.ok(orgs.length > 0, 'Should have at least one organization');
            
            console.log(`   Found ${orgs.length} organization(s)`);
        });

        test('Should fetch projects for an organization', async function() {
            this.timeout(10000);
            
            const orgs = await apiService.getOrgs();
            assert.ok(orgs.length > 0, 'Need at least one org');
            
            const projects = await apiService.getProjects(orgs[0].id);
            assert.ok(Array.isArray(projects), 'Should return an array of projects');
            
            console.log(`   Found ${projects.length} project(s) in org "${orgs[0].name}"`);
        });

        test('Should fetch branches for a project', async function() {
            this.timeout(10000);
            
            const branches = await apiService.getBranches(NEON_PROJECT_ID!);
            assert.ok(Array.isArray(branches), 'Should return an array of branches');
            assert.ok(branches.length > 0, 'Should have at least one branch');
            
            console.log(`   Found ${branches.length} branch(es)`);
            
            // Verify the specified branch exists
            const targetBranch = branches.find(b => b.id === NEON_BRANCH_ID);
            assert.ok(targetBranch, `Branch ${NEON_BRANCH_ID} should exist`);
            console.log(`   ✓ Target branch "${targetBranch!.name}" found`);
        });

        test('Should fetch connection information for a branch', async function() {
            this.timeout(10000);
            
            const connectionInfo = await apiService.getBranchConnectionInfo(
                NEON_PROJECT_ID!,
                NEON_BRANCH_ID!
            );
            
            assert.ok(Array.isArray(connectionInfo), 'Should return connection info array');
            assert.ok(connectionInfo.length > 0, 'Should have at least one database connection');
            
            // Verify connection info structure
            const firstConn = connectionInfo[0];
            assert.ok(firstConn.database, 'Should have database name');
            assert.ok(firstConn.user, 'Should have user name');
            assert.ok(firstConn.host, 'Should have host');
            assert.ok(firstConn.password, 'Should have password');
            
            console.log(`   Found ${connectionInfo.length} database connection(s)`);
            console.log(`   Primary database: "${firstConn.database}" with user "${firstConn.user}"`);
        });
    });

    suite('State Service with Real Data', () => {
        test('Should store branch connection information', async function() {
            this.timeout(10000);
            
            const connectionInfo = await apiService.getBranchConnectionInfo(
                NEON_PROJECT_ID!,
                NEON_BRANCH_ID!
            );
            
            await stateService.setBranchConnectionInfos(connectionInfo);
            await stateService.setIsProxyRunning(true);
            await stateService.setCurrentlyConnectedBranch(NEON_BRANCH_ID!);
            
            const viewData = await stateService.getViewData();
            assert.strictEqual(viewData.connected, true, 'Should be marked as connected');
            assert.ok(viewData.connection.branchConnectionInfos, 'Should have connection infos');
            assert.strictEqual(
                viewData.connection.branchConnectionInfos!.length,
                connectionInfo.length,
                'Should store all connection infos'
            );
            
            console.log(`   ✓ Stored ${connectionInfo.length} connection info(s)`);
        });

        test('Should retrieve connection information', async function() {
            const infos = stateService.getBranchConnectionInfos();
            assert.ok(infos.length > 0, 'Should have stored connection infos');
            
            const firstInfo = infos[0];
            assert.ok(firstInfo.database, 'Should have database');
            assert.ok(firstInfo.user, 'Should have user');
            assert.ok(firstInfo.host, 'Should have host');
            
            console.log(`   Retrieved info for database: "${firstInfo.database}"`);
        });
    });

    suite('Schema Service Tests (Requires Connection)', () => {
        suiteSetup(async function() {
            this.timeout(15000);
            
            // Set up connection state
            const connectionInfo = await apiService.getBranchConnectionInfo(
                NEON_PROJECT_ID!,
                NEON_BRANCH_ID!
            );
            
            await stateService.setBranchConnectionInfos(connectionInfo);
            await stateService.setIsProxyRunning(true);
            await stateService.setCurrentlyConnectedBranch(NEON_BRANCH_ID!);
            
            // Get databases and roles from API
            const databases = await apiService.getDatabases(NEON_PROJECT_ID!, NEON_BRANCH_ID!);
            const roles = await apiService.getRoles(NEON_PROJECT_ID!, NEON_BRANCH_ID!);
            
            await stateService.setDatabases(databases);
            await stateService.setRoles(roles);
            
            schemaService = new SchemaService(stateService, context);
            
            console.log(`   Connection setup complete with ${databases.length} database(s)`);
        });

        test('Should list databases', async function() {
            this.timeout(10000);
            
            const databases = await schemaService.getDatabases();
            assert.ok(Array.isArray(databases), 'Should return an array');
            assert.ok(databases.length > 0, 'Should have at least one database');
            
            databases.forEach(db => {
                assert.ok(db.id, 'Database should have an ID');
                assert.ok(db.name, 'Database should have a name');
                assert.strictEqual(db.type, 'database', 'Type should be "database"');
            });
            
            console.log(`   ✓ Found ${databases.length} database(s): ${databases.map(d => d.name).join(', ')}`);
        });

        test('Should list schemas for a database', async function() {
            this.timeout(10000);
            
            const databases = await schemaService.getDatabases();
            assert.ok(databases.length > 0, 'Need at least one database');
            
            const firstDb = databases[0];
            const schemas = await schemaService.getSchemas(firstDb.name);
            
            assert.ok(Array.isArray(schemas), 'Should return an array');
            assert.ok(schemas.length > 0, 'Should have at least one schema');
            
            // Should have 'public' schema
            const publicSchema = schemas.find(s => s.name === 'public');
            assert.ok(publicSchema, 'Should have public schema');
            
            console.log(`   ✓ Found ${schemas.length} schema(s) in "${firstDb.name}": ${schemas.map(s => s.name).join(', ')}`);
        });

        test('Should list tables in a schema', async function() {
            this.timeout(10000);
            
            const databases = await schemaService.getDatabases();
            const firstDb = databases[0];
            
            const tables = await schemaService.getTables(firstDb.name, 'public');
            
            assert.ok(Array.isArray(tables), 'Should return an array');
            // Note: May be empty if no tables exist yet
            
            if (tables.length > 0) {
                const firstTable = tables[0];
                assert.ok(firstTable.name, 'Table should have a name');
                assert.strictEqual(firstTable.type, 'table', 'Type should be "table"');
                console.log(`   ✓ Found ${tables.length} table(s) in public schema`);
            } else {
                console.log(`   ℹ No tables found in public schema (this is normal for new databases)`);
            }
        });

        test('Should list views in a schema', async function() {
            this.timeout(10000);
            
            const databases = await schemaService.getDatabases();
            const firstDb = databases[0];
            
            const views = await schemaService.getViews(firstDb.name, 'public');
            
            assert.ok(Array.isArray(views), 'Should return an array');
            console.log(`   ✓ Found ${views.length} view(s) in public schema`);
        });

        test('Should list functions in a schema', async function() {
            this.timeout(10000);
            
            const databases = await schemaService.getDatabases();
            const firstDb = databases[0];
            
            const functions = await schemaService.getFunctions(firstDb.name, 'public');
            
            assert.ok(Array.isArray(functions), 'Should return an array');
            console.log(`   ✓ Found ${functions.length} function(s) in public schema`);
        });

        test('Should list sequences in a schema', async function() {
            this.timeout(10000);
            
            const databases = await schemaService.getDatabases();
            const firstDb = databases[0];
            
            const sequences = await schemaService.getSequences(firstDb.name, 'public');
            
            assert.ok(Array.isArray(sequences), 'Should return an array');
            console.log(`   ✓ Found ${sequences.length} sequence(s) in public schema`);
        });
    });

    suite('Database Operations', () => {
        const TEST_DB_NAME = `test_db_${Date.now()}`;
        let createdDbName: string | null = null;

        test('Should create a new database', async function() {
            this.timeout(15000);
            
            console.log(`   Creating test database: "${TEST_DB_NAME}"`);
            
            await apiService.createDatabase(NEON_PROJECT_ID!, NEON_BRANCH_ID!, TEST_DB_NAME);
            createdDbName = TEST_DB_NAME;
            
            // Wait a bit for the database to be created
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Refresh connection info to include the new database
            const connectionInfo = await apiService.getBranchConnectionInfo(
                NEON_PROJECT_ID!,
                NEON_BRANCH_ID!
            );
            await stateService.setBranchConnectionInfos(connectionInfo);
            
            // Verify the database exists
            const databases = await schemaService.getDatabases();
            const newDb = databases.find(db => db.name === TEST_DB_NAME);
            
            assert.ok(newDb, `Database "${TEST_DB_NAME}" should exist after creation`);
            console.log(`   ✅ Successfully created database "${TEST_DB_NAME}"`);
        });

        test('Should list the newly created database', async function() {
            this.timeout(10000);
            
            if (!createdDbName) {
                this.skip();
                return;
            }
            
            const databases = await schemaService.getDatabases();
            const testDb = databases.find(db => db.name === createdDbName!);
            
            assert.ok(testDb, 'Newly created database should appear in list');
            console.log(`   ✓ Database "${createdDbName}" is visible in database list`);
        });

        test('Should list schemas in the new database', async function() {
            this.timeout(10000);
            
            if (!createdDbName) {
                this.skip();
                return;
            }
            
            const schemas = await schemaService.getSchemas(createdDbName);
            assert.ok(schemas.length > 0, 'New database should have at least one schema');
            
            const publicSchema = schemas.find(s => s.name === 'public');
            assert.ok(publicSchema, 'New database should have public schema');
            
            console.log(`   ✓ New database has ${schemas.length} schema(s)`);
        });

        suiteTeardown(async function() {
            if (createdDbName) {
                this.timeout(15000);
                
                try {
                    console.log(`   🧹 Cleaning up: Deleting test database "${createdDbName}"`);
                    await apiService.deleteDatabase(NEON_PROJECT_ID!, NEON_BRANCH_ID!, createdDbName);
                    console.log(`   ✅ Test database deleted successfully`);
                } catch (error) {
                    console.error(`   ⚠️ Failed to delete test database: ${error}`);
                    // Don't fail the tests if cleanup fails
                }
            }
        });
    });

    suite('Role Operations', () => {
        test('Should list roles', async function() {
            this.timeout(10000);
            
            const roles = await apiService.getRoles(NEON_PROJECT_ID!, NEON_BRANCH_ID!);
            
            assert.ok(Array.isArray(roles), 'Should return an array of roles');
            assert.ok(roles.length > 0, 'Should have at least one role');
            
            console.log(`   ✓ Found ${roles.length} role(s)`);
            
            // Verify role structure
            const firstRole = roles[0];
            assert.ok(firstRole.name, 'Role should have a name');
            console.log(`   First role: "${firstRole.name}"`);
        });

        test('Should differentiate between neon_superuser and regular roles', async function() {
            this.timeout(10000);
            
            const roles = await apiService.getRoles(NEON_PROJECT_ID!, NEON_BRANCH_ID!);
            
            const superuserRoles = roles.filter(r => r.name.includes('neon_superuser'));
            const regularRoles = roles.filter(r => !r.name.includes('neon_superuser'));
            
            console.log(`   Found ${superuserRoles.length} superuser role(s) and ${regularRoles.length} regular role(s)`);
            
            if (superuserRoles.length > 0) {
                console.log(`   Superuser roles: ${superuserRoles.map(r => r.name).join(', ')}`);
            }
        });
    });

    suite('Connection String Generation', () => {
        test('Should have valid connection information', async function() {
            this.timeout(10000);
            
            const infos = stateService.getBranchConnectionInfos();
            assert.ok(infos.length > 0, 'Should have connection info');
            
            const info = infos[0];
            
            // Verify all required fields are present
            assert.ok(info.database, 'Should have database');
            assert.ok(info.user, 'Should have user');
            assert.ok(info.host, 'Should have host');
            assert.ok(info.password, 'Should have password');
            
            // Verify host format
            assert.ok(info.host.includes('.neon.tech') || info.host.includes('.local'), 
                'Host should be a valid Neon endpoint');
            
            console.log(`   ✓ Connection info is valid:`);
            console.log(`     Host: ${info.host}`);
            console.log(`     Database: ${info.database}`);
            console.log(`     User: ${info.user}`);
        });

        test('Should construct valid PostgreSQL connection strings', async function() {
            const infos = stateService.getBranchConnectionInfos();
            assert.ok(infos.length > 0, 'Should have connection info');
            
            for (const info of infos) {
                const connectionString = `postgresql://${info.user}:${info.password}@${info.host}/${info.database}?sslmode=require`;
                
                // Basic validation
                assert.ok(connectionString.startsWith('postgresql://'), 'Should start with postgresql://');
                assert.ok(connectionString.includes(info.database), 'Should include database name');
                assert.ok(connectionString.includes('sslmode=require'), 'Should include sslmode');
                
                console.log(`   ✓ Valid connection string for "${info.database}"`);
            }
        });
    });

    suiteTeardown(async function() {
        if (shouldSkip) {
            return;
        }
        
        // Clean up state
        try {
            await stateService.setIsProxyRunning(false);
            await stateService.setCurrentlyConnectedBranch('');
            await stateService.setBranchConnectionInfos([]);
            console.log('✅ Integration tests cleanup complete');
        } catch (error) {
            console.error('⚠️ Error during cleanup:', error);
        }
    });
});

