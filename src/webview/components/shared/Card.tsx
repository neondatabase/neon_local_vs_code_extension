import React from 'react';
import { componentStyles, spacing } from '../../design-system';

interface CardProps {
  title?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ title, children, actions, style }) => {
  return (
    <div style={{ ...componentStyles.card.base, ...style }}>
      {(title || actions) && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: spacing.md 
        }}>
          {title && <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>{title}</h3>}
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
};


