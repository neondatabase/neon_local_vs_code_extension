import React, { useState, useEffect } from 'react';
import {
    Button,
    Section,
    PermissionsTable,
    Select,
    MultiSelectCheckbox,
    ActionButtons,
    useScrollToError
} from '../shared';
import { spacing } from '../../design-system';

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

// ==================== ManagePermissions Component ====================

interface ManagePermissionsProps {
    username: string;
    permissions: Array<{
        schema_name: string;
        table_name: string;
        object_type: string;
        privileges: string[];
    }>;
    dbPermissions: Array<{
        database_name: string;
        privileges: string[];
    }>;
    schemas: string[];
}

export const ManagePermissionsComponent: React.FC = () => {
    const initialData = (window as any).initialData as ManagePermissionsProps || {
        username: '',
        permissions: [],
        dbPermissions: [],
        schemas: []
    };

    const [username] = useState(initialData.username);
    const [permissions, setPermissions] = useState(initialData.permissions);
    const [dbPermissions, setDbPermissions] = useState(initialData.dbPermissions);
    const [schemas] = useState(initialData.schemas);

    // Listen for refresh messages
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'refreshPermissions') {
                setPermissions(message.permissions);
                setDbPermissions(message.dbPermissions);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const handleAddPermissions = () => {
        vscode.postMessage({
            command: 'openAddPermissions',
            schemas
        });
    };

    const handleRevoke = (permission: any) => {
        vscode.postMessage({
            command: 'confirmRevoke',
            confirmMessage: `Are you sure you want to revoke ${permission.privileges.join(', ')} on ${permission.object}?`,
            revoke: permission
        });
    };

    // Format object permissions for the table
    const formattedPermissions = permissions.map(perm => {
        const objectTypeMap: Record<string, string> = {
            'r': 'Table',
            'v': 'View',
            'm': 'Materialized View',
            'S': 'Sequence',
            'f': 'Function'
        };

        return {
            type: objectTypeMap[perm.object_type] || 'Object',
            object: `${perm.schema_name}.${perm.table_name}`,
            privileges: perm.privileges,
            onRevoke: () => handleRevoke({
                schema: perm.schema_name,
                objectName: perm.table_name,
                objectType: perm.object_type,
                privileges: perm.privileges
            })
        };
    });

    // Format database permissions for the table
    const formattedDbPermissions = dbPermissions.map(dbPerm => ({
        type: 'Database',
        object: dbPerm.database_name,
        privileges: dbPerm.privileges,
        onRevoke: () => handleRevoke({
            databaseName: dbPerm.database_name,
            privileges: dbPerm.privileges
        })
    }));

    const allPermissions = [...formattedDbPermissions, ...formattedPermissions];

    return (
        <div style={{ padding: spacing.lg }}>
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: spacing.lg 
            }}>
                <h2 style={{ margin: 0, fontSize: '18px' }}>
                    Permissions for {username}
                </h2>
                <Button onClick={handleAddPermissions} variant="primary">
                    Add Permissions
                </Button>
            </div>

            <Section title="Current Permissions">
                <PermissionsTable
                    permissions={allPermissions}
                    onRevoke={handleRevoke}
                    emptyMessage="No permissions granted yet. Click 'Add Permissions' to grant privileges."
                />
            </Section>
        </div>
    );
};

// ==================== AddPermissions Component ====================

interface AddPermissionsProps {
    username: string;
    schemas: string[];
}

const OBJECT_TYPES = [
    { value: 'table', label: 'Table' },
    { value: 'schema', label: 'Schema' },
    { value: 'database', label: 'Database' },
    { value: 'sequence', label: 'Sequence' },
    { value: 'function', label: 'Function' }
];

const TABLE_PRIVILEGES = [
    { value: 'SELECT', label: 'SELECT - Read data' },
    { value: 'INSERT', label: 'INSERT - Add rows' },
    { value: 'UPDATE', label: 'UPDATE - Modify rows' },
    { value: 'DELETE', label: 'DELETE - Remove rows' },
    { value: 'TRUNCATE', label: 'TRUNCATE - Remove all rows' },
    { value: 'REFERENCES', label: 'REFERENCES - Create foreign keys' },
    { value: 'TRIGGER', label: 'TRIGGER - Create triggers' }
];

const SCHEMA_PRIVILEGES = [
    { value: 'CREATE', label: 'CREATE - Create objects' },
    { value: 'USAGE', label: 'USAGE - Access schema' }
];

const DATABASE_PRIVILEGES = [
    { value: 'CREATE', label: 'CREATE - Create schemas' },
    { value: 'CONNECT', label: 'CONNECT - Connect to database' },
    { value: 'TEMPORARY', label: 'TEMPORARY - Create temp tables' }
];

const SEQUENCE_PRIVILEGES = [
    { value: 'USAGE', label: 'USAGE - Use sequence' },
    { value: 'SELECT', label: 'SELECT - Read sequence value' },
    { value: 'UPDATE', label: 'UPDATE - Set sequence value' }
];

const FUNCTION_PRIVILEGES = [
    { value: 'EXECUTE', label: 'EXECUTE - Run function' }
];

export const AddPermissionsComponent: React.FC = () => {
    const initialData = (window as any).initialData as AddPermissionsProps || {
        username: '',
        schemas: []
    };

    const [username] = useState(initialData.username);
    const [schemas] = useState(initialData.schemas);
    const [objectType, setObjectType] = useState<string>('table');
    const [schema, setSchema] = useState<string>(schemas[0] || '');
    const [objectName, setObjectName] = useState<string>('');
    const [availableObjects, setAvailableObjects] = useState<Array<{ value: string; label: string }>>([]);
    const [selectedPrivileges, setSelectedPrivileges] = useState<string[]>([]);
    const [grantOption, setGrantOption] = useState(false);
    const [applyToFuture, setApplyToFuture] = useState(false);

    // Get available objects when schema or object type changes
    useEffect(() => {
        if (objectType !== 'database' && objectType !== 'schema' && schema) {
            vscode.postMessage({
                command: 'getObjects',
                schema,
                objectType
            });
        }
    }, [schema, objectType]);

    // Listen for object list
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === 'updateObjects') {
                setAvailableObjects(message.objects.map((obj: string) => ({
                    value: obj,
                    label: obj
                })));
                if (message.objects.length > 0) {
                    setObjectName(message.objects[0]);
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

    const getPrivilegeOptions = () => {
        switch (objectType) {
            case 'table':
                return TABLE_PRIVILEGES;
            case 'schema':
                return SCHEMA_PRIVILEGES;
            case 'database':
                return DATABASE_PRIVILEGES;
            case 'sequence':
                return SEQUENCE_PRIVILEGES;
            case 'function':
                return FUNCTION_PRIVILEGES;
            default:
                return TABLE_PRIVILEGES;
        }
    };

    const handleGrant = () => {
        const grant: any = {
            objectType,
            privileges: selectedPrivileges,
            grantOption,
            applyToFuture
        };

        if (objectType === 'database') {
            // Database-level grant - no schema or objectName needed
            grant.database = objectName || 'current';
        } else if (objectType === 'schema') {
            grant.schema = schema;
        } else {
            grant.schema = schema;
            grant.objectName = objectName;
        }

        vscode.postMessage({
            command: 'grantPermission',
            grant
        });
    };

    const handleCancel = () => {
        vscode.postMessage({ command: 'cancel' });
    };

    const isValid = () => {
        if (selectedPrivileges.length === 0) return false;
        if (objectType === 'database') return true;
        if (objectType === 'schema') return !!schema;
        return !!schema && !!objectName;
    };

    return (
        <div style={{ padding: spacing.lg }}>
            <h2 style={{ marginTop: 0, marginBottom: spacing.lg, fontSize: '18px' }}>
                Add Permissions for {username}
            </h2>

            <Section title="Grant Details">
                <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.md }}>
                    <Select
                        label="Object Type"
                        value={objectType}
                        onChange={(e) => {
                            setObjectType(e.target.value);
                            setSelectedPrivileges([]);
                        }}
                        options={OBJECT_TYPES}
                    />

                    {objectType !== 'database' && (
                        <Select
                            label="Schema"
                            value={schema}
                            onChange={(e) => setSchema(e.target.value)}
                            options={schemas.map(s => ({ value: s, label: s }))}
                            disabled={objectType === 'database'}
                        />
                    )}

                    {objectType !== 'database' && objectType !== 'schema' && availableObjects.length > 0 && (
                        <Select
                            label={`${objectType.charAt(0).toUpperCase() + objectType.slice(1)} Name`}
                            value={objectName}
                            onChange={(e) => setObjectName(e.target.value)}
                            options={availableObjects}
                        />
                    )}

                    <MultiSelectCheckbox
                        label="Privileges"
                        options={getPrivilegeOptions()}
                        selectedValues={selectedPrivileges}
                        onChange={setSelectedPrivileges}
                        helperText="Select one or more privileges to grant"
                    />

                    {objectType === 'table' && (
                        <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                                <input
                                    type="checkbox"
                                    id="grantOption"
                                    checked={grantOption}
                                    onChange={(e) => setGrantOption(e.target.checked)}
                                />
                                <label htmlFor="grantOption" style={{ margin: 0, cursor: 'pointer' }}>
                                    WITH GRANT OPTION (allow user to grant these privileges to others)
                                </label>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: spacing.sm }}>
                                <input
                                    type="checkbox"
                                    id="applyToFuture"
                                    checked={applyToFuture}
                                    onChange={(e) => setApplyToFuture(e.target.checked)}
                                />
                                <label htmlFor="applyToFuture" style={{ margin: 0, cursor: 'pointer' }}>
                                    Apply to future objects in schema
                                </label>
                            </div>
                        </>
                    )}
                </div>
            </Section>

            <ActionButtons
                onSave={handleGrant}
                onCancel={handleCancel}
                saveLabel="Grant"
                saveDisabled={!isValid()}
            />
        </div>
    );
};

