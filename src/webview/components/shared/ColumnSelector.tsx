import React, { useState } from 'react';
import { colors, spacing, borderRadius, fontSize } from '../../design-system';

interface Column {
  name: string;
  type: string;
  isAdvanced?: boolean;
}

interface ColumnSelectorProps {
  availableColumns: Column[];
  selectedColumns: string[];
  onSelectionChange: (columns: string[]) => void;
  showAdvanced?: boolean;
}

export const ColumnSelector: React.FC<ColumnSelectorProps> = ({
  availableColumns,
  selectedColumns,
  onSelectionChange,
  showAdvanced = false,
}) => {
  const [showAdvancedColumns, setShowAdvancedColumns] = useState(showAdvanced);

  const visibleColumns = showAdvancedColumns
    ? availableColumns
    : availableColumns.filter((col) => !col.isAdvanced);

  const toggleColumn = (columnName: string) => {
    if (selectedColumns.includes(columnName)) {
      onSelectionChange(selectedColumns.filter((c) => c !== columnName));
    } else {
      onSelectionChange([...selectedColumns, columnName]);
    }
  };

  const selectAll = () => {
    onSelectionChange(visibleColumns.map((col) => col.name));
  };

  const deselectAll = () => {
    onSelectionChange([]);
  };

  return (
    <div>
      <div style={{ marginBottom: spacing.md, display: 'flex', gap: spacing.sm }}>
        <button
          onClick={selectAll}
          style={{
            padding: `${spacing.xs} ${spacing.sm}`,
            fontSize: fontSize.sm,
            background: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.sm,
            cursor: 'pointer',
            color: colors.textPrimary,
          }}
        >
          Select All
        </button>
        <button
          onClick={deselectAll}
          style={{
            padding: `${spacing.xs} ${spacing.sm}`,
            fontSize: fontSize.sm,
            background: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: borderRadius.sm,
            cursor: 'pointer',
            color: colors.textPrimary,
          }}
        >
          Deselect All
        </button>
        {availableColumns.some((col) => col.isAdvanced) && (
          <button
            onClick={() => setShowAdvancedColumns(!showAdvancedColumns)}
            style={{
              padding: `${spacing.xs} ${spacing.sm}`,
              fontSize: fontSize.sm,
              background: 'none',
              border: `1px solid ${colors.border}`,
              borderRadius: borderRadius.sm,
              cursor: 'pointer',
              color: colors.textPrimary,
            }}
          >
            {showAdvancedColumns ? 'Hide' : 'Show'} Advanced
          </button>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: spacing.sm,
          maxHeight: '300px',
          overflow: 'auto',
          padding: spacing.sm,
          backgroundColor: colors.backgroundLight,
          border: `1px solid ${colors.border}`,
          borderRadius: borderRadius.md,
        }}
      >
        {visibleColumns.map((column) => (
          <label
            key={column.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              padding: spacing.sm,
              borderRadius: borderRadius.sm,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = colors.listHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <input
              type="checkbox"
              checked={selectedColumns.includes(column.name)}
              onChange={() => toggleColumn(column.name)}
              style={{ marginRight: spacing.sm, cursor: 'pointer' }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: fontSize.sm,
                  color: colors.textPrimary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {column.name}
              </div>
              <div
                style={{
                  fontSize: fontSize.xs,
                  color: colors.textSecondary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {column.type}
              </div>
            </div>
          </label>
        ))}
      </div>

      <div style={{ marginTop: spacing.sm, fontSize: fontSize.sm, color: colors.textSecondary }}>
        {selectedColumns.length} of {visibleColumns.length} columns selected
      </div>
    </div>
  );
};


