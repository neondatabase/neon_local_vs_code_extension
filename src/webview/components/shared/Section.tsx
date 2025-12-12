import React, { useState } from 'react';
import { colors, spacing, borderRadius } from '../../design-system';

interface CollapsibleSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  defaultOpen = false,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div
      style={{
        backgroundColor: colors.backgroundLight,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        marginBottom: spacing.md,
        overflow: 'hidden',
      }}
    >
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: spacing.md,
          cursor: 'pointer',
          userSelect: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: spacing.sm,
          fontWeight: 500,
          fontSize: '13px',
          transition: 'background-color 150ms',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = colors.listHover)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <span
          style={{
            display: 'inline-block',
            transition: 'transform 0.2s ease',
            transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
            fontSize: '10px',
          }}
        >
          ▶
        </span>
        <span>{title}</span>
      </div>
      {isOpen && (
        <div style={{ padding: spacing.md, paddingTop: 0 }}>
          {children}
        </div>
      )}
    </div>
  );
};

interface SectionProps {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export const Section: React.FC<SectionProps> = ({ title, children, style }) => {
  return (
    <div
      style={{
        backgroundColor: colors.backgroundLight,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
        ...style,
      }}
    >
      {title && (
        <h3
          style={{
            margin: 0,
            marginBottom: spacing.md,
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          {title}
        </h3>
      )}
      {children}
    </div>
  );
};


