import React, { useState } from 'react';
import { colors, spacing, borderRadius, fontSize, fontWeight } from '../../design-system';

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
          fontWeight: fontWeight.medium,
          fontSize: fontSize.md,
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
        <div 
          className="section-content"
          style={{ 
            padding: spacing.md, 
            paddingTop: spacing.lg,
            display: 'flex',
            flexDirection: 'column',
            gap: spacing.md
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

interface SectionProps {
  title?: string;
  description?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  noPadding?: boolean;
}

export const Section: React.FC<SectionProps> = ({ 
  title, 
  description,
  headerActions,
  children, 
  style,
  noPadding = false
}) => {
  return (
    <div
      style={{
        backgroundColor: colors.backgroundLight,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        padding: noPadding ? 0 : spacing.md,
        marginBottom: spacing.md,
        ...style,
      }}
    >
      {(title || description || headerActions) && (
        <div style={{ marginBottom: spacing.lg }}>
          {(title || headerActions) && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: description ? spacing.xs : 0,
            }}>
              {title && (
                <h3
                  style={{
                    margin: 0,
                    fontSize: fontSize.lg,
                    fontWeight: fontWeight.semibold,
                  }}
                >
                  {title}
                </h3>
              )}
              {headerActions && (
                <div>{headerActions}</div>
              )}
            </div>
          )}
          {description && (
            <div
              style={{
                fontSize: fontSize.sm,
                color: colors.textSecondary,
                fontStyle: 'italic',
              }}
            >
              {description}
            </div>
          )}
        </div>
      )}
      <div 
        className="section-content"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: spacing.md,
          paddingTop: (title || description || headerActions) ? 0 : spacing.lg
        }}
      >
        {children}
      </div>
    </div>
  );
};



