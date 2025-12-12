import React, { useState } from 'react';
import { colors, spacing, fontSize, borderRadius } from '../../design-system';
import { Button } from './Button';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  itemsPerPage?: number;
  onPageChange: (page: number) => void;
  showPageInfo?: boolean;
  showItemCount?: boolean;
}

export const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  totalItems,
  itemsPerPage,
  onPageChange,
  showPageInfo = true,
  showItemCount = false,
}) => {
  const handlePrevious = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNext = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const handleFirst = () => {
    onPageChange(1);
  };

  const handleLast = () => {
    onPageChange(totalPages);
  };

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);

      if (currentPage > 3) {
        pages.push('...');
      }

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      if (currentPage < totalPages - 2) {
        pages.push('...');
      }

      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.md,
        backgroundColor: colors.backgroundLight,
        border: `1px solid ${colors.border}`,
        borderRadius: borderRadius.md,
        gap: spacing.md,
      }}
    >
      {/* Page info */}
      <div style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
        {showPageInfo && (
          <span>
            Page {currentPage} of {totalPages}
          </span>
        )}
        {showItemCount && totalItems !== undefined && itemsPerPage !== undefined && (
          <span style={{ marginLeft: spacing.sm }}>
            ({Math.min((currentPage - 1) * itemsPerPage + 1, totalItems)}-
            {Math.min(currentPage * itemsPerPage, totalItems)} of {totalItems.toLocaleString()})
          </span>
        )}
      </div>

      {/* Pagination controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: spacing.xs }}>
        <Button size="sm" onClick={handleFirst} disabled={currentPage === 1}>
          «
        </Button>
        <Button size="sm" onClick={handlePrevious} disabled={currentPage === 1}>
          ‹
        </Button>

        {getPageNumbers().map((page, index) =>
          typeof page === 'number' ? (
            <button
              key={index}
              onClick={() => onPageChange(page)}
              style={{
                padding: `${spacing.xs} ${spacing.sm}`,
                minWidth: '32px',
                backgroundColor: page === currentPage ? colors.primary : 'transparent',
                color: page === currentPage ? colors.primaryForeground : colors.textPrimary,
                border: `1px solid ${colors.border}`,
                borderRadius: borderRadius.sm,
                cursor: 'pointer',
                fontSize: fontSize.sm,
                fontWeight: page === currentPage ? 600 : 400,
              }}
            >
              {page}
            </button>
          ) : (
            <span key={index} style={{ padding: `0 ${spacing.xs}`, color: colors.textSecondary }}>
              {page}
            </span>
          )
        )}

        <Button size="sm" onClick={handleNext} disabled={currentPage === totalPages}>
          ›
        </Button>
        <Button size="sm" onClick={handleLast} disabled={currentPage === totalPages}>
          »
        </Button>
      </div>
    </div>
  );
};

interface SimplePaginationProps {
  currentPage: number;
  onPageChange: (page: number) => void;
  hasMore: boolean;
  itemCount?: number;
}

export const SimplePagination: React.FC<SimplePaginationProps> = ({
  currentPage,
  onPageChange,
  hasMore,
  itemCount,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: spacing.sm,
        gap: spacing.md,
      }}
    >
      <div style={{ fontSize: fontSize.sm, color: colors.textSecondary }}>
        {itemCount !== undefined && <span>{itemCount.toLocaleString()} items</span>}
      </div>

      <div style={{ display: 'flex', gap: spacing.sm }}>
        <Button size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
          Previous
        </Button>
        <span style={{ padding: `${spacing.xs} ${spacing.sm}`, fontSize: fontSize.sm }}>
          Page {currentPage}
        </span>
        <Button size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={!hasMore}>
          Next
        </Button>
      </div>
    </div>
  );
};


