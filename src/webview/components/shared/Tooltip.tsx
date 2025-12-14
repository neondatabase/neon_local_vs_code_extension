import React, { useRef, useEffect, useState } from 'react';

interface TooltipProps {
  text: string;
  className?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ text, className = '' }) => {
  const iconRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });

  const updateTooltipPosition = () => {
    if (iconRef.current && tooltipRef.current) {
      const iconRect = iconRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      
      // Position below the icon
      let top = iconRect.bottom + 8;
      // Center horizontally on the icon
      let left = iconRect.left + (iconRect.width / 2) - (tooltipRect.width / 2);

      // Ensure tooltip doesn't go off-screen
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Adjust horizontal position if tooltip would overflow
      if (left < 8) {
        left = 8;
      } else if (left + tooltipRect.width > viewportWidth - 8) {
        left = viewportWidth - tooltipRect.width - 8;
      }

      // Adjust vertical position if tooltip would overflow (position above instead)
      if (top + tooltipRect.height > viewportHeight - 8) {
        top = iconRect.top - tooltipRect.height - 8;
      }

      setTooltipPosition({ top, left });
    }
  };

  useEffect(() => {
    if (isHovered) {
      // Small delay to ensure tooltip is rendered before positioning
      const timer = setTimeout(updateTooltipPosition, 10);
      return () => clearTimeout(timer);
    }
  }, [isHovered]);

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
  };

  return (
    <div 
      ref={iconRef}
      className={`tooltip-container ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        cursor: 'help',
        position: 'relative'
      }}
    >
      <svg 
        width="12" 
        height="12" 
        viewBox="0 0 14 14" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        style={{
          color: 'var(--vscode-descriptionForeground)',
          opacity: 0.7
        }}
      >
        <circle cx="7" cy="7" r="6.5" stroke="currentColor" strokeWidth="1" fill="none"/>
        <path 
          d="M7 10.5V10M7 8.5C7 7.5 8 7 8 7C8 6 7.5 5.5 7 5.5C6.5 5.5 6 6 6 6.5" 
          stroke="currentColor" 
          strokeWidth="1" 
          strokeLinecap="round" 
          strokeLinejoin="round"
        />
      </svg>
      {isHovered && (
        <div 
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
            backgroundColor: 'var(--vscode-editorHoverWidget-background)',
            border: '1px solid var(--vscode-editorHoverWidget-border)',
            color: 'var(--vscode-editorHoverWidget-foreground)',
            padding: '8px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            lineHeight: '1.5',
            maxWidth: '300px',
            wordWrap: 'break-word',
            zIndex: 10000,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
            pointerEvents: 'none'
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
};

