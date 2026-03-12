/**
 * Legacy Input Group Component
 *
 * Replicates the input-group styles from wallet-legacy
 */

import { InputHTMLAttributes, forwardRef } from 'react';

export interface LegacyInputGroupProps extends InputHTMLAttributes<HTMLInputElement> {
  prefix?: string;
  suffix?: string;
  error?: boolean;
}

export const LegacyInputGroup = forwardRef<HTMLInputElement, LegacyInputGroupProps>(
  ({ prefix, suffix, error = false, className = '', ...props }, ref) => {
    return (
      <div className={`
        input-group flex border rounded-legacy overflow-hidden
        ${error ? 'border-steem-red ring-1 ring-steem-red' : ''}
      `}>
        {prefix && (
          <span className="input-group-label px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-r border-gray-300 dark:border-gray-600">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          className="input-group-field flex-1 px-3 py-2 border-none outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          {...props}
        />
        {suffix && (
          <span className="input-group-label px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-l border-gray-300 dark:border-gray-600">
            {suffix}
          </span>
        )}
      </div>
    );
  }
);

LegacyInputGroup.displayName = 'LegacyInputGroup';
