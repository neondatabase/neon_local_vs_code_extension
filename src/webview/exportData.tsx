import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExportDataView } from './components/panels/ExportData';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<ExportDataView />);
}


