import React from 'react';
import { CollapsibleSection } from './Section';
import { CodeBlock } from './CodeBlock';

interface SqlPreviewProps {
  sql: string;
  defaultOpen?: boolean;
  title?: string;
  showCopy?: boolean;
}

export const SqlPreview: React.FC<SqlPreviewProps> = ({
  sql,
  defaultOpen = false,
  title = 'SQL Preview',
  showCopy = true,
}) => {
  return (
    <CollapsibleSection title={title} defaultOpen={defaultOpen}>
      <CodeBlock code={sql} language="sql" showCopy={showCopy} />
    </CollapsibleSection>
  );
};


