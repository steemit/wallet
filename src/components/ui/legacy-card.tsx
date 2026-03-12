/**
 * Legacy Card Component
 *
 * Replicates the module card styles from wallet-legacy
 */

import { HTMLAttributes, forwardRef } from 'react';

export interface LegacyCardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
  variant?: 'default' | 'warning' | 'highlight';
}

export const LegacyCard = forwardRef<HTMLDivElement, LegacyCardProps>(
  ({ padding = 'md', variant = 'default', children, className = '', ...props }, ref) => {
    // Padding styles
    const paddingStyles = {
      none: '',
      sm: 'p-4',
      md: 'p-6',
      lg: 'p-8',
    };

    // Variant styles
    const variantStyles: Record<NonNullable<typeof variant>, string> = {
      default: 'bg-module border border-themed shadow-sm rounded-legacy',
      warning: 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-legacy',
      highlight: 'bg-[#f3faf0] dark:bg-[#0f1f16] border border-green-200 dark:border-green-800 rounded-legacy',
    };

    return (
      <div
        ref={ref}
        className={`
          ${variantStyles[variant]}
          ${paddingStyles[padding]}
          ${className}
        `}
        {...props}
      >
        {children}
      </div>
    );
  }
);

LegacyCard.displayName = 'LegacyCard';
