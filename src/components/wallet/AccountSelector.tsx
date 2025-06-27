
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { User, Search } from "lucide-react";

interface AccountSelectorProps {
  onAccountSelect: (username: string) => void;
  currentAccount?: string;
}

const AccountSelector = ({ onAccountSelect, currentAccount }: AccountSelectorProps) => {
  const [username, setUsername] = useState(currentAccount || "");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username.trim()) {
      onAccountSelect(username.trim().toLowerCase());
    }
  };

  return (
    <Card className="bg-white border border-gray-200 shadow-sm mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-gray-800 flex items-center gap-2">
          <User className="w-5 h-5" style={{ color: '#07d7a9' }} />
          Account Lookup
        </CardTitle>
        <CardDescription className="text-gray-500">
          Enter a Steem username to view wallet information
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="username" className="sr-only">Username</Label>
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username (e.g., steemit)"
              className="border-gray-300"
            />
          </div>
          <Button 
            type="submit" 
            className="text-white flex items-center gap-2"
            style={{ backgroundColor: '#07d7a9' }}
            disabled={!username.trim()}
          >
            <Search className="w-4 h-4" />
            Load
          </Button>
        </form>
        {currentAccount && (
          <p className="text-sm text-gray-600 mt-2">
            Currently viewing: <span className="font-medium">@{currentAccount}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default AccountSelector;
