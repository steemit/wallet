
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReactNode } from "react";

interface WalletCardProps {
  title: string;
  description: string;
  amount: string;
  currency: string;
  subtitle?: string;
  gradient?: boolean;
  actionButton?: ReactNode;
}

const WalletCard = ({ 
  title, 
  description, 
  amount, 
  currency, 
  subtitle, 
  gradient = false,
  actionButton
}: WalletCardProps) => {
  return (
    <Card className={`${gradient ? 'bg-gradient-to-br from-steemit-500 to-steemit-600 text-white' : 'bg-white border border-gray-200 shadow-sm'}`}>
      <CardHeader className="pb-3">
        <CardTitle className={gradient ? "text-white" : "text-gray-800"}>{title}</CardTitle>
        <CardDescription className={gradient ? "text-steemit-100" : "text-gray-500 text-sm"}>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`text-2xl font-bold ${gradient ? 'text-white' : 'text-gray-900'}`}>
            {amount}
          </span>
          <span className={`text-sm ${gradient ? 'text-steemit-100' : 'text-gray-500'}`}>
            {currency}
          </span>
        </div>
        {subtitle && (
          <p className={`text-xs ${gradient ? 'text-steemit-100' : 'text-gray-500'}`}>
            {subtitle}
          </p>
        )}
        {actionButton && (
          <div className="mt-3">
            {actionButton}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default WalletCard;
