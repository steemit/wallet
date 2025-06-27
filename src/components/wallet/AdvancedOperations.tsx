
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import WithdrawRouteOperations from "./WithdrawRouteOperations";
import ProposalOperations from "./ProposalOperations";

const AdvancedOperations = () => {
  const [witnessUrl, setWitnessUrl] = useState("");
  const [blockSigningKey, setBlockSigningKey] = useState("");
  const [isWitnessActive, setIsWitnessActive] = useState(false);
  const [multisigThreshold, setMultisigThreshold] = useState("");
  const [authorizedAccount, setAuthorizedAccount] = useState("");
  const [permissionLevel, setPermissionLevel] = useState("posting");
  const [advancedFeaturesEnabled, setAdvancedFeaturesEnabled] = useState(false);
  const { toast } = useToast();

  const handleWitnessUpdate = () => {
    if (!witnessUrl || !blockSigningKey) return;
    toast({
      title: "Witness Updated",
      description: "Witness node configuration has been updated",
    });
  };

  const handleDisableWitness = () => {
    toast({
      title: "Witness Disabled",
      description: "Witness node has been disabled",
    });
    setIsWitnessActive(false);
  };

  const handleAuthorizeAccount = () => {
    if (!authorizedAccount) return;
    toast({
      title: "Account Authorized",
      description: `@${authorizedAccount} authorized for ${permissionLevel} operations`,
    });
  };

  const handleGenerateBrainKey = () => {
    toast({
      title: "Brain Key Generated",
      description: "New brain key has been generated securely",
    });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader>
          <CardTitle className="text-slate-200">Advanced Features Toggle</CardTitle>
          <CardDescription className="text-slate-400">
            Enable advanced wallet features for power users
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-slate-300">Advanced Features</Label>
              <p className="text-sm text-slate-400">Enable witness operations, multisig, and other advanced features</p>
            </div>
            <Switch 
              checked={advancedFeaturesEnabled}
              onCheckedChange={setAdvancedFeaturesEnabled}
            />
          </div>
          
          {!advancedFeaturesEnabled && (
            <div className="bg-yellow-900/20 border border-yellow-600/30 p-4 rounded-lg">
              <p className="text-yellow-300 text-sm">
                Enable advanced features to access witness operations, authority management, and other power user tools.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {advancedFeaturesEnabled && (
        <Tabs defaultValue="witness" className="w-full">
          <TabsList className="grid w-full grid-cols-6 bg-slate-800/50">
            <TabsTrigger value="witness" className="data-[state=active]:bg-blue-600">Witness</TabsTrigger>
            <TabsTrigger value="withdraw-route" className="data-[state=active]:bg-blue-600">Withdraw Route</TabsTrigger>
            <TabsTrigger value="proposals" className="data-[state=active]:bg-blue-600">Proposals</TabsTrigger>
            <TabsTrigger value="authority" className="data-[state=active]:bg-blue-600">Authority</TabsTrigger>
            <TabsTrigger value="multisig" className="data-[state=active]:bg-blue-600">Multisig</TabsTrigger>
            <TabsTrigger value="utility" className="data-[state=active]:bg-blue-600">Utility</TabsTrigger>
          </TabsList>

          <TabsContent value="witness" className="space-y-4">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-200">Witness Operations</CardTitle>
                <CardDescription className="text-slate-400">
                  Configure and manage your witness node
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-slate-700/30 rounded-lg">
                  <div>
                    <p className="text-slate-200 font-medium">Witness Status</p>
                    <p className="text-sm text-slate-400">Current operational status</p>
                  </div>
                  <Badge variant={isWitnessActive ? "default" : "destructive"}>
                    {isWitnessActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="witness-url" className="text-slate-300">Witness URL</Label>
                  <Input
                    id="witness-url"
                    value={witnessUrl}
                    onChange={(e) => setWitnessUrl(e.target.value)}
                    placeholder="https://your-witness-site.com"
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signing-key" className="text-slate-300">Block Signing Key</Label>
                  <Input
                    id="signing-key"
                    value={blockSigningKey}
                    onChange={(e) => setBlockSigningKey(e.target.value)}
                    placeholder="STM..."
                    className="bg-slate-700 border-slate-600 text-white font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Button 
                    onClick={handleWitnessUpdate} 
                    className="bg-blue-600 hover:bg-blue-700"
                    disabled={!witnessUrl || !blockSigningKey}
                  >
                    Update Witness
                  </Button>
                  <Button 
                    onClick={handleDisableWitness} 
                    variant="outline"
                    className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white"
                  >
                    Disable Witness
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="withdraw-route" className="space-y-4">
            <WithdrawRouteOperations />
          </TabsContent>

          <TabsContent value="proposals" className="space-y-4">
            <ProposalOperations />
          </TabsContent>

          <TabsContent value="authority" className="space-y-4">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-200">Authority Management</CardTitle>
                <CardDescription className="text-slate-400">
                  Manage account permissions and authorizations
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="authorized-account" className="text-slate-300">Account to Authorize</Label>
                    <Input
                      id="authorized-account"
                      value={authorizedAccount}
                      onChange={(e) => setAuthorizedAccount(e.target.value)}
                      placeholder="account-name"
                      className="bg-slate-700 border-slate-600 text-white"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="permission-level" className="text-slate-300">Permission Level</Label>
                    <Select value={permissionLevel} onValueChange={setPermissionLevel}>
                      <SelectTrigger className="bg-slate-700 border-slate-600 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-700 border-slate-600">
                        <SelectItem value="posting">Posting</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="owner">Owner</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button 
                  onClick={handleAuthorizeAccount} 
                  className="w-full bg-green-600 hover:bg-green-700"
                  disabled={!authorizedAccount}
                >
                  Authorize Account
                </Button>

                <div className="bg-red-900/20 border border-red-600/30 p-4 rounded-lg">
                  <h4 className="font-medium text-red-400 mb-2">🔒 Security Warning:</h4>
                  <ul className="text-sm text-red-300 space-y-1">
                    <li>• Only authorize accounts you completely trust</li>
                    <li>• Higher permissions grant more control</li>
                    <li>• Review authorizations regularly</li>
                    <li>• Remove unused authorizations</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-200">Current Authorizations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-slate-700/30 rounded-lg">
                    <div>
                      <p className="text-white font-medium">@steemit</p>
                      <p className="text-sm text-slate-400">Posting authority</p>
                    </div>
                    <Button variant="outline" size="sm" className="border-red-600 text-red-400 hover:bg-red-600 hover:text-white">
                      Revoke
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="multisig" className="space-y-4">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-200">Multisignature Operations</CardTitle>
                <CardDescription className="text-slate-400">
                  Configure multisig requirements for enhanced security
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="multisig-threshold" className="text-slate-300">Signature Threshold</Label>
                  <Input
                    id="multisig-threshold"
                    value={multisigThreshold}
                    onChange={(e) => setMultisigThreshold(e.target.value)}
                    placeholder="Number of required signatures"
                    className="bg-slate-700 border-slate-600 text-white"
                  />
                </div>

                <div className="bg-blue-900/20 border border-blue-600/30 p-4 rounded-lg">
                  <h4 className="font-medium text-blue-400 mb-2">💡 Multisig Benefits:</h4>
                  <ul className="text-sm text-blue-300 space-y-1">
                    <li>• Require multiple signatures for transactions</li>
                    <li>• Enhanced security for high-value operations</li>
                    <li>• Shared control with trusted parties</li>
                    <li>• Protection against single point of failure</li>
                  </ul>
                </div>

                <Button className="w-full bg-blue-600 hover:bg-blue-700">
                  Configure Multisig
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="utility" className="space-y-4">
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader>
                <CardTitle className="text-slate-200">Utility Functions</CardTitle>
                <CardDescription className="text-slate-400">
                  Additional tools and utilities
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Button 
                    onClick={handleGenerateBrainKey}
                    className="bg-purple-600 hover:bg-purple-700"
                  >
                    Generate Brain Key
                  </Button>
                  
                  <Button 
                    variant="outline"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    Account Estimation
                  </Button>
                  
                  <Button 
                    variant="outline"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    Legacy Code Cleanup
                  </Button>
                  
                  <Button 
                    variant="outline"
                    className="border-slate-600 text-slate-300 hover:bg-slate-700"
                  >
                    Update FAQ
                  </Button>
                </div>

                <Card className="bg-slate-700/30 border-slate-600">
                  <CardHeader>
                    <CardTitle className="text-slate-200 text-lg">SBD Conversion</CardTitle>
                    <CardDescription className="text-slate-400">
                      Convert SBD to STEEM at current feed price
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Current Rate:</span>
                      <span className="text-white">1 SBD = 1.142 STEEM</span>
                    </div>
                    <Button className="w-full bg-orange-600 hover:bg-orange-700">
                      Convert SBD to STEEM
                    </Button>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
};

export default AdvancedOperations;
