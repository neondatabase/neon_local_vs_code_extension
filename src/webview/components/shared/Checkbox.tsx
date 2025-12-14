import React from 'react';
import { spacing } from '../../design-system';
import { Tooltip } from './Tooltip';

interface CheckboxProps {
    label: string;
    checked: boolean;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    disabled?: boolean;
    labelTooltip?: string;
    style?: React.CSSProperties;
}

export const Checkbox: React.FC<CheckboxProps> = ({
    label,
    checked,
    onChange,
    disabled = false,
    labelTooltip,
    style
}) => {
    return (
        <label 
            style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: spacing.sm, 
                cursor: disabled ? 'not-allowed' : 'pointer',
                ...style
            }}
        >
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                disabled={disabled}
                style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
            />
            <span 
                style={{ 
                    fontSize: '13px', 
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                }}
            >
                {label}
                {labelTooltip && <Tooltip text={labelTooltip} />}
            </span>
        </label>
    );
};

