import React, { useState, useRef, useEffect } from 'react';
import { colors, spacing } from '../../design-system';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultSplit?: number; // Percentage (0-100)
  minSize?: number; // Minimum size in pixels
  orientation?: 'horizontal' | 'vertical';
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  defaultSplit = 50,
  minSize = 100,
  orientation = 'horizontal',
}) => {
  const [split, setSplit] = useState(defaultSplit);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();

      if (orientation === 'horizontal') {
        const newSplit = ((e.clientX - rect.left) / rect.width) * 100;
        const minPercent = (minSize / rect.width) * 100;
        const maxPercent = 100 - minPercent;
        setSplit(Math.max(minPercent, Math.min(maxPercent, newSplit)));
      } else {
        const newSplit = ((e.clientY - rect.top) / rect.height) * 100;
        const minPercent = (minSize / rect.height) * 100;
        const maxPercent = 100 - minPercent;
        setSplit(Math.max(minPercent, Math.min(maxPercent, newSplit)));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, minSize, orientation]);

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Left/Top pane */}
      <div
        style={{
          [isHorizontal ? 'width' : 'height']: `${split}%`,
          overflow: 'auto',
          flexShrink: 0,
        }}
      >
        {left}
      </div>

      {/* Splitter */}
      <div
        onMouseDown={handleMouseDown}
        style={{
          [isHorizontal ? 'width' : 'height']: '4px',
          backgroundColor: colors.border,
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          flexShrink: 0,
          transition: isDragging ? 'none' : 'background-color 150ms',
          userSelect: 'none',
        }}
        onMouseEnter={(e) => {
          if (!isDragging) {
            e.currentTarget.style.backgroundColor = colors.focusBorder;
          }
        }}
        onMouseLeave={(e) => {
          if (!isDragging) {
            e.currentTarget.style.backgroundColor = colors.border;
          }
        }}
      />

      {/* Right/Bottom pane */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
        }}
      >
        {right}
      </div>
    </div>
  );
};

interface ResizablePanelProps {
  children: React.ReactNode;
  defaultWidth?: number;
  defaultHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
}

export const ResizablePanel: React.FC<ResizablePanelProps> = ({
  children,
  defaultWidth = 300,
  defaultHeight = 200,
  minWidth = 100,
  minHeight = 100,
  maxWidth,
  maxHeight,
}) => {
  const [width, setWidth] = useState(defaultWidth);
  const [height, setHeight] = useState(defaultHeight);
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !panelRef.current) return;

      const rect = panelRef.current.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      const newHeight = e.clientY - rect.top;

      setWidth(Math.max(minWidth, maxWidth ? Math.min(maxWidth, newWidth) : newWidth));
      setHeight(Math.max(minHeight, maxHeight ? Math.min(maxHeight, newHeight) : newHeight));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isResizing, minWidth, minHeight, maxWidth, maxHeight]);

  return (
    <div
      ref={panelRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        position: 'relative',
        border: `1px solid ${colors.border}`,
        overflow: 'auto',
      }}
    >
      {children}

      {/* Resize handle */}
      <div
        onMouseDown={() => setIsResizing(true)}
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: '16px',
          height: '16px',
          cursor: 'nwse-resize',
          backgroundColor: colors.border,
          borderTopLeftRadius: '4px',
        }}
      />
    </div>
  );
};


