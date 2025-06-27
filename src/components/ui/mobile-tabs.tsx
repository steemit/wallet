
import * as React from "react";
import { cn } from "@/lib/utils";

interface MobileTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

interface MobileTabsListProps {
  children: React.ReactNode;
  className?: string;
}

interface MobileTabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

interface MobileTabsContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

const MobileTabsContext = React.createContext<{
  value: string;
  onValueChange: (value: string) => void;
} | null>(null);

const MobileTabs = ({ value, onValueChange, children, className }: MobileTabsProps) => {
  return (
    <MobileTabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn("w-full", className)}>{children}</div>
    </MobileTabsContext.Provider>
  );
};

const MobileTabsList = ({ children, className }: MobileTabsListProps) => {
  return (
    <div className={cn(
      "bg-white border border-gray-200 rounded-lg overflow-x-auto",
      className
    )}>
      <div className="flex p-1 gap-1">
        {children}
      </div>
    </div>
  );
};

const MobileTabsTrigger = ({ value, children, className, disabled = false }: MobileTabsTriggerProps) => {
  const context = React.useContext(MobileTabsContext);
  if (!context) throw new Error("MobileTabsTrigger must be used within MobileTabs");

  const isActive = context.value === value;

  return (
    <button
      onClick={() => !disabled && context.onValueChange(value)}
      disabled={disabled}
      className={cn(
        "flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors",
        "min-w-max whitespace-nowrap",
        disabled
          ? "text-gray-400 cursor-not-allowed opacity-50"
          : isActive
          ? "bg-steemit-500 text-white"
          : "text-gray-600 hover:text-gray-900 hover:bg-gray-100",
        className
      )}
    >
      {children}
    </button>
  );
};

const MobileTabsContent = ({ value, children, className }: MobileTabsContentProps) => {
  const context = React.useContext(MobileTabsContext);
  if (!context) throw new Error("MobileTabsContent must be used within MobileTabs");

  if (context.value !== value) return null;

  return (
    <div className={className}>
      {children}
    </div>
  );
};

export { MobileTabs, MobileTabsList, MobileTabsTrigger, MobileTabsContent };
