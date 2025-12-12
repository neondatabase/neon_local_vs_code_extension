import React from 'react';
import { colors, spacing, borderRadius } from '../../design-system';

interface TableColumn<T> {
  header: string;
  accessor: keyof T | ((row: T) => React.ReactNode);
  width?: string;
}

interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
}

export function Table<T extends { id?: string | number }>({ 
  columns, 
  data, 
  onRowClick,
  emptyMessage = 'No data available' 
}: TableProps<T>) {
  return (
    <div style={{ overflow: 'auto', border: `1px solid ${colors.border}`, borderRadius: borderRadius.md }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ backgroundColor: colors.backgroundLight, borderBottom: `1px solid ${colors.border}` }}>
            {columns.map((col, idx) => (
              <th
                key={idx}
                style={{
                  padding: spacing.md,
                  textAlign: 'left',
                  fontWeight: 600,
                  fontSize: '13px',
                  width: col.width,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                style={{
                  padding: spacing.xl,
                  textAlign: 'center',
                  color: colors.textSecondary,
                }}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr
                key={row.id || rowIdx}
                onClick={() => onRowClick?.(row)}
                style={{
                  borderBottom: `1px solid ${colors.border}`,
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background-color 150ms',
                }}
                onMouseEnter={(e) => {
                  if (onRowClick) {
                    e.currentTarget.style.backgroundColor = colors.listHover;
                  }
                }}
                onMouseLeave={(e) => {
                  if (onRowClick) {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }
                }}
              >
                {columns.map((col, colIdx) => (
                  <td key={colIdx} style={{ padding: spacing.md, fontSize: '13px' }}>
                    {typeof col.accessor === 'function'
                      ? col.accessor(row)
                      : String(row[col.accessor] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}


