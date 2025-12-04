# Neon Local Connect - Test Suite

This extension has two types of tests: **Unit Tests** and **Integration Tests**.

## Unit Tests

Unit tests verify the extension's basic functionality without requiring external dependencies.

### Running Unit Tests

```bash
npm test
```

These tests verify:
- ✅ Extension activation
- ✅ Command registration
- ✅ Configuration accessibility
- ✅ View providers
- ✅ Error handling

## Integration Tests

Integration tests verify the schema view functionality against a **real Neon branch**. These tests require valid Neon credentials.

### Prerequisites

Before running integration tests, you need:

1. **A Neon account** with at least one project
2. **A Neon API token** (Personal Access Token)
3. **A project ID** to test against
4. **A branch ID** within that project

### Getting Your Credentials

#### 1. Get Your Neon API Token

1. Go to [Neon Console](https://console.neon.tech)
2. Click on your profile (bottom left)
3. Go to **Account Settings**
4. Navigate to **API Keys**
5. Click **Create new API key**
6. Copy the token (it won't be shown again!)

#### 2. Get Your Project ID

1. In the Neon Console, select your project
2. Go to **Settings** → **General**
3. Copy the **Project ID** (starts with `proud-`, `quiet-`, etc.)

#### 3. Get Your Branch ID

1. In your project, go to **Branches**
2. Click on the branch you want to test with
3. Copy the **Branch ID** from the URL or branch details

### Running Integration Tests

#### Option 1: Using Environment Variables

```bash
# Set the required environment variables
export NEON_API_TOKEN="your_api_token_here"
export NEON_PROJECT_ID="your_project_id_here"
export NEON_BRANCH_ID="your_branch_id_here"

# Run all tests (including integration tests)
npm test
```

#### Option 2: Using a .env File (Not Recommended)

**⚠️ Never commit credentials to version control!**

If you must use a .env file for local testing:

1. Add `.env.test` to `.gitignore` (already done)
2. Create `.env.test` with:

```bash
NEON_API_TOKEN=your_api_token_here
NEON_PROJECT_ID=your_project_id_here
NEON_BRANCH_ID=your_branch_id_here
```

3. Load it before running tests:

```bash
source .env.test
npm test
```

### What Integration Tests Do

The integration tests will:

1. **✅ Connect to your real Neon branch**
   - Authenticate using your API token
   - Fetch organization and project details

2. **✅ Test API Operations**
   - Fetch organizations
   - Fetch projects
   - Fetch branches
   - Get connection information

3. **✅ Test Schema Operations**
   - List databases
   - List schemas within databases
   - List tables, views, functions, and sequences
   - Query schema structure

4. **✅ Test Database CRUD Operations**
   - Create a test database (named `test_db_[timestamp]`)
   - Verify the database exists
   - List schemas in the new database
   - **Automatically delete the test database** (cleanup)

5. **✅ Test Role Management**
   - List all roles
   - Differentiate between neon_superuser and regular roles

6. **✅ Test Connection Strings**
   - Validate connection information
   - Generate PostgreSQL connection strings

### Skipping Integration Tests

If you don't set the environment variables, the integration tests will **automatically skip** with a message:

```
⚠️  Skipping integration tests - missing environment variables
   Set NEON_API_TOKEN, NEON_PROJECT_ID, and NEON_BRANCH_ID to run these tests
```

This means you can always run `npm test` safely, and integration tests will only run when you explicitly provide credentials.

## Test Output

### Successful Unit Tests

```
Neon Local Connect Extension Tests
  Extension Basics
    ✓ Extension should be present
    ✓ Extension should activate without errors
  Commands
    ✓ Critical commands should be registered
    ✓ Should register all expected database commands
    ...
```

### Successful Integration Tests

```
Schema View Integration Tests (Real Neon Branch)
  🔧 Setting up integration tests with real Neon branch...
  ✅ Services initialized successfully
  
  API Service Tests
    ✓ Should fetch organizations (Found 2 organization(s))
    ✓ Should fetch projects for an organization (Found 5 project(s))
    ✓ Should fetch branches for a project (Found 3 branch(es))
    ...
    
  Database Operations
    ✓ Should create a new database (Created test_db_1234567890)
    ✓ Should list the newly created database
    🧹 Cleaning up: Deleting test database "test_db_1234567890"
    ✅ Test database deleted successfully
```

## CI/CD Integration

For continuous integration:

1. **Add secrets** to your CI/CD platform:
   - `NEON_API_TOKEN`
   - `NEON_PROJECT_ID`
   - `NEON_BRANCH_ID`

2. **Configure your CI workflow** to export these as environment variables

3. **Run tests:**
   ```bash
   npm test
   ```

Integration tests will automatically run when credentials are available.

## Troubleshooting

### "Extension not found"
- Make sure the extension is installed
- Try running: `npm run compile` first

### "Module not found" errors
- Run: `npm install`
- Ensure all dependencies are installed

### Integration tests failing
- **Verify your API token is valid** (not expired)
- **Check project and branch IDs are correct**
- **Ensure your Neon account has access** to the specified project
- **Check your network connection** (firewall, VPN, etc.)
- **Verify the branch is not deleted or suspended**

### Database creation fails
- Check if you have **permission to create databases** in the branch
- Verify your **plan limits** (some plans limit database count)

## Test Structure

```
src/test/
├── suite/
│   ├── extension.test.ts      # Unit tests (no credentials needed)
│   ├── integration.test.ts    # Integration tests (credentials required)
│   └── index.ts               # Test runner configuration
└── runTest.ts                 # VS Code test runner
```

## Writing New Tests

### Adding Unit Tests

Add to `src/test/suite/extension.test.ts`:

```typescript
test('Your test name', () => {
    // Your test code
    assert.ok(true, 'Should pass');
});
```

### Adding Integration Tests

Add to `src/test/suite/integration.test.ts`:

```typescript
test('Your integration test', async function() {
    this.timeout(10000); // Set appropriate timeout
    
    // Your test code that uses real Neon services
    const result = await schemaService.getDatabases();
    assert.ok(result);
});
```

## Best Practices

1. **✅ Always clean up** resources created in tests
2. **✅ Use unique names** for test databases (timestamp-based)
3. **✅ Set appropriate timeouts** for async operations (10-15 seconds)
4. **✅ Never commit credentials** to version control
5. **✅ Make integration tests skippable** (check for env vars)
6. **✅ Add descriptive console logs** for debugging
7. **✅ Handle errors gracefully** in teardown

## Support

If you encounter issues:
1. Check the [Neon Documentation](https://neon.tech/docs)
2. Open an issue in the repository
3. Contact Neon support for API-related issues

