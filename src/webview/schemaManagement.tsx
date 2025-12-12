import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreateSchemaView, EditSchemaView } from './components/panels/SchemaManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    const initialData = (window as any).initialData;
    
    // Determine which view to render based on mode
    const mode = initialData?.mode || 'create';
    
    if (mode === 'edit') {
        root.render(<EditSchemaView />);
    } else {
        root.render(<CreateSchemaView />);
    }
}


