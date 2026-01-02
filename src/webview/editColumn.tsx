import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditColumnComponent } from './components/panels/ColumnManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<EditColumnComponent />);
}


