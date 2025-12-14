import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreateViewComponent } from './components/panels/ViewManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<CreateViewComponent />);
}


