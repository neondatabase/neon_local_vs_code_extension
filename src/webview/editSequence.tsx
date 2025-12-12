import React from 'react';
import { createRoot } from 'react-dom/client';
import { EditSequenceComponent } from './components/panels/SequenceManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<EditSequenceComponent />);
}

