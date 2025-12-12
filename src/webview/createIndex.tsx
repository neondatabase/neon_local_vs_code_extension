import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreateIndexComponent } from './components/panels/IndexManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<CreateIndexComponent />);
}

