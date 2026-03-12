/**
 * Legacy Button Component
 *
 * Replicates the e-btn, e-btn-hollow, and e-btn-black styles from wallet-legacy
 */

import { ButtonHTMLAttributes, forwardRef } from 'react';

export type LegacyButtonVariant = 'primary' | 'hollow' | 'black';

export interface LegacyButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: LegacyButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const LegacyButton = forwardRef<HTMLButtonElement, LegacyButtonProps>(
  ({ variant = 'primary', size = 'md', fullWidth = false, children, className = '', ...props }, ref) => {
    // Base styles
    const baseStyles = 'font-bold text-transform-capitalize transition-all duration-200 disabled:opacity-25 disabled:cursor-not-allowed';

    // Size styles
    const sizeStyles = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-base',
      lg: 'px-6 py-3 text-lg',
    };

    // Variant styles
    const variantStyles: Record<LegacyButtonVariant, string> = {
      primary: 'bg-steem-blue text-white shadow-button hover:bg-steem-blue-light hover:shadow-button-hover hover:-translate-y-[2px] hover:translate-x-[2px]',
      hollow: 'bg-transparent border border-teal text-teal hover:bg-teal hover:text-white',
      black: 'bg-[#171F24] text-white shadow-[0px_0px_0px_0_rgba(0,0,0,0),5px_5px_0_0_#06D6A9] hover:bg-teal hover:shadow-[2px_2px_2px_0_rgba(0,0,0,0.1),7px_7px_0_0_#171F24]',
    };

    return (
      <button
        ref={ref}
        className={`
          ${baseStyles}
          ${sizeStyles[size]}
          ${variantStyles[variant]}
          ${fullWidth ? 'w-full' : ''}
          ${className}
        `}
        {...props}
      >
        {children}
      </button>
    );
  }
);

LegacyButton.displayName = 'LegacyButton';
