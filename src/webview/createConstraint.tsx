import React from 'react';
import { createRoot } from 'react-dom/client';
import { CreateConstraintComponent } from './components/panels/ConstraintManagement';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<CreateConstraintComponent />);
}


