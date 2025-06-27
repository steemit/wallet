import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Shield, Key, RefreshCw, AlertTriangle, Copy, Check, Eye, EyeOff, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import * as dsteem from 'dsteem';
import { steemOperations } from '@/services/steemOperations';

interface AccountSecurityOperationsProps {
  loggedInUser: string | null;
  accountData?: any;
}

const AccountSecurityOperations = ({ loggedInUser, accountData }: AccountSecurityOperationsProps) => {
  const [activeTab, setActiveTab] = useState("keys");
  const [isLoading, setIsLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showPrivateKeys, setShowPrivateKeys] = useState(false);
  const [revealedPrivateKeys, setRevealedPrivateKeys] = useState<any>(null);
  const { toast } = useToast();

  // Password Change State
  const [passwordData, setPasswordData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmReady: false
  });
  const [generatedKeys, setGeneratedKeys] = useState<any>(null);

  // Reset Account State
  const [resetAccountData, setResetAccountData] = useState({
    currentResetAccount: '',
    newResetAccount: ''
  });

  const loginMethod = localStorage.getItem('steem_login_method');

  const canRevealPrivateKeys = () => {
    return loginMethod === 'masterpassword' || loginMethod === 'privatekey';
  };

  const handleRevealPrivateKeys = () => {
    if (!loggedInUser || !canRevealPrivateKeys()) {
      toast({
        title: "Access Denied",
        description: "Private key revelation requires master password or private key login",
        variant: "destructive",
      });
      return;
    }

    try {
      const masterPassword = localStorage.getItem('steem_master_password');
      const storedKeys = {
        owner: localStorage.getItem('steem_owner_key'),
        active: localStorage.getItem('steem_active_key'),
        posting: localStorage.getItem('steem_posting_key'),
        memo: localStorage.getItem('steem_memo_key')
      };

      let privateKeys: any = {};

      if (masterPassword) {
        // Generate keys from master password using the correct method
        privateKeys = steemOperations.generateKeys(loggedInUser, masterPassword, ['owner', 'active', 'posting', 'memo']);
      } else {
        // Use stored private keys
        Object.entries(storedKeys).forEach(([role, key]) => {
          if (key) {
            privateKeys[role] = {
              private: key,
              public: steemOperations.wifToPublic(key)
            };
          }
        });
      }

      setRevealedPrivateKeys(privateKeys);
      setShowPrivateKeys(true);

      toast({
        title: "Private Keys Revealed",
        description: "Handle with extreme care! Never share your private keys.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to Reveal Keys",
        description: error.message || "Could not retrieve private keys",
        variant: "destructive",
      });
    }
  };

  // Generate a secure random password
  const generateSecurePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 16; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  };

  const handleGenerateNewPassword = async () => {
    if (!loggedInUser || !passwordData.oldPassword) {
      toast({
        title: "Missing Information",
        description: "Please enter your current password",
        variant: "destructive",
      });
      return;
    }

    const ownerKey = localStorage.getItem('steem_owner_key');
    const activeKey = localStorage.getItem('steem_active_key');
    
    if (!ownerKey && !activeKey) {
      toast({
        title: "Key Required",
        description: "Owner or Active key is required for password change",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      // Generate a new secure password
      const newPassword = generateSecurePassword();
      
      // Generate new keys from the new password using the correct method
      const newKeys = steemOperations.generateKeys(loggedInUser, newPassword, ['owner', 'active', 'posting', 'memo']);
      
      setPasswordData({ ...passwordData, newPassword, confirmReady: true });
      setGeneratedKeys(newKeys);

      toast({
        title: "New Password Generated",
        description: "Please copy your new password and keys before confirming the change",
      });
    } catch (error: any) {
      toast({
        title: "Password Generation Failed",
        description: error.message || "Failed to generate new password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmPasswordChange = async () => {
    if (!generatedKeys || !loggedInUser || !passwordData.confirmReady) return;

    setIsLoading(true);

    try {
      // Try owner key first, then active key
      const ownerKeyString = localStorage.getItem('steem_owner_key');
      const activeKeyString = localStorage.getItem('steem_active_key');
      
      let privateKey: dsteem.PrivateKey;
      if (ownerKeyString) {
        privateKey = dsteem.PrivateKey.fromString(ownerKeyString);
      } else if (activeKeyString) {
        privateKey = dsteem.PrivateKey.fromString(activeKeyString);
      } else {
        toast({
          title: "Key Required",
          description: "Owner or Active key is required for password change",
          variant: "destructive",
        });
        return;
      }

      // Create new authorities
      const newOwnerAuth = {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[generatedKeys.owner.public, 1]]
      };
      
      const newActiveAuth = {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[generatedKeys.active.public, 1]]
      };
      
      const newPostingAuth = {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[generatedKeys.posting.public, 1]]
      };

      // Update account with new keys
      const accountUpdateOp: dsteem.Operation = [
        'account_update',
        {
          account: loggedInUser,
          owner: newOwnerAuth,
          active: newActiveAuth,
          posting: newPostingAuth,
          memo_key: generatedKeys.memo.public,
          json_metadata: ''
        }
      ];

      await steemOperations.broadcastOperation([accountUpdateOp], privateKey);

      toast({
        title: "Password Changed Successfully",
        description: "Your account password has been updated. Please save your new keys!",
      });

      // Clear sensitive data
      setPasswordData({ oldPassword: '', newPassword: '', confirmReady: false });
      setGeneratedKeys(null);
    } catch (error: any) {
      toast({
        title: "Password Change Failed",
        description: error.message || "Failed to change password",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetResetAccount = async () => {
    if (!loggedInUser || !resetAccountData.newResetAccount) {
      toast({
        title: "Missing Information",
        description: "Please enter the reset account username",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      if (loginMethod === 'keychain') {
        window.steem_keychain.requestBroadcast(
          loggedInUser,
          [['set_reset_account', {
            account: loggedInUser,
            current_reset_account: resetAccountData.currentResetAccount,
            reset_account: resetAccountData.newResetAccount
          }]],
          'Owner',
          (response: any) => {
            if (response.success) {
              toast({
                title: "Reset Account Updated",
                description: "Your recovery account has been set successfully",
              });
              setResetAccountData({ currentResetAccount: '', newResetAccount: '' });
            } else {
              toast({
                title: "Operation Failed",
                description: response.message || "Failed to set reset account",
                variant: "destructive",
              });
            }
            setIsLoading(false);
          }
        );
      } else {
        const ownerKeyString = localStorage.getItem('steem_owner_key');
        if (!ownerKeyString) {
          toast({
            title: "Owner Key Required",
            description: "Owner key is required for this operation",
            variant: "destructive",
          });
          return;
        }

        const ownerKey = dsteem.PrivateKey.fromString(ownerKeyString);
        
        await steemOperations.setResetAccount({
          account: loggedInUser,
          current_reset_account: resetAccountData.currentResetAccount,
          reset_account: resetAccountData.newResetAccount
        }, ownerKey);

        toast({
          title: "Reset Account Updated",
          description: "Your recovery account has been set successfully",
        });

        setResetAccountData({ currentResetAccount: '', newResetAccount: '' });
        setIsLoading(false);
      }
    } catch (error: any) {
      toast({
        title: "Operation Failed",
        description: error.message || "Failed to set reset account",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const copyToClipboard = async (text: string, keyType: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(keyType);
      setTimeout(() => setCopiedKey(null), 2000);
      
      toast({
        title: "Copied to Clipboard",
        description: `${keyType} copied successfully`,
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  if (!loggedInUser) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <Shield className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              Account Security
            </h3>
            <p className="text-gray-500">
              Please log in to access account security features
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Account Security
          </CardTitle>
          <CardDescription>
            Manage your account security settings, keys, and recovery options
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="keys">Keys</TabsTrigger>
              <TabsTrigger value="recovery">Recovery</TabsTrigger>
              <TabsTrigger value="password">Password</TabsTrigger>
            </TabsList>

            <TabsContent value="keys" className="space-y-6">
              {/* Current Account Keys Section */}
              {accountData && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-lg font-semibold">Current Account Keys</Label>
                    {canRevealPrivateKeys() && (
                      <Button
                        onClick={handleRevealPrivateKeys}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2"
                      >
                        {showPrivateKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        {showPrivateKeys ? 'Hide' : 'Reveal'} Private Keys
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4">
                    {/* Owner Key */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="font-semibold text-red-600">Owner Key</Label>
                        <Badge variant="destructive">Highest Authority</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-16">Public:</span>
                          <Input
                            value={accountData.owner?.key_auths?.[0]?.[0] || 'N/A'}
                            readOnly
                            className="font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyToClipboard(accountData.owner?.key_auths?.[0]?.[0] || '', 'owner public')}
                          >
                            {copiedKey === 'owner public' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                        {showPrivateKeys && revealedPrivateKeys?.owner && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-16">Private:</span>
                            <Input
                              value={revealedPrivateKeys.owner.private}
                              readOnly
                              className="font-mono text-xs bg-red-50"
                              type="password"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyToClipboard(revealedPrivateKeys.owner.private, 'owner private')}
                            >
                              {copiedKey === 'owner private' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Active Key */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="font-semibold text-orange-600">Active Key</Label>
                        <Badge variant="secondary">Financial Operations</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-16">Public:</span>
                          <Input
                            value={accountData.active?.key_auths?.[0]?.[0] || 'N/A'}
                            readOnly
                            className="font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyToClipboard(accountData.active?.key_auths?.[0]?.[0] || '', 'active public')}
                          >
                            {copiedKey === 'active public' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                        {showPrivateKeys && revealedPrivateKeys?.active && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-16">Private:</span>
                            <Input
                              value={revealedPrivateKeys.active.private}
                              readOnly
                              className="font-mono text-xs bg-orange-50"
                              type="password"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyToClipboard(revealedPrivateKeys.active.private, 'active private')}
                            >
                              {copiedKey === 'active private' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Posting Key */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="font-semibold text-blue-600">Posting Key</Label>
                        <Badge variant="outline">Content & Social</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-16">Public:</span>
                          <Input
                            value={accountData.posting?.key_auths?.[0]?.[0] || 'N/A'}
                            readOnly
                            className="font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyToClipboard(accountData.posting?.key_auths?.[0]?.[0] || '', 'posting public')}
                          >
                            {copiedKey === 'posting public' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                        {showPrivateKeys && revealedPrivateKeys?.posting && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-16">Private:</span>
                            <Input
                              value={revealedPrivateKeys.posting.private}
                              readOnly
                              className="font-mono text-xs bg-blue-50"
                              type="password"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyToClipboard(revealedPrivateKeys.posting.private, 'posting private')}
                            >
                              {copiedKey === 'posting private' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </Button>
                          </div>
                        )}
                        {accountData.posting?.account_auths?.length > 0 && (
                          <div className="mt-2">
                            <div className="flex items-center gap-2 mb-1">
                              <Users className="w-4 h-4 text-gray-500" />
                              <span className="text-xs text-gray-500">Authorized Accounts:</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {accountData.posting.account_auths.map(([account]: [string, number]) => (
                                <Badge key={account} variant="outline" className="text-xs">
                                  @{account}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Memo Key */}
                    <div className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="font-semibold text-green-600">Memo Key</Label>
                        <Badge variant="outline">Private Messages</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 w-16">Public:</span>
                          <Input
                            value={accountData.memo_key || 'N/A'}
                            readOnly
                            className="font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyToClipboard(accountData.memo_key || '', 'memo public')}
                          >
                            {copiedKey === 'memo public' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          </Button>
                        </div>
                        {showPrivateKeys && revealedPrivateKeys?.memo && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 w-16">Private:</span>
                            <Input
                              value={revealedPrivateKeys.memo.private}
                              readOnly
                              className="font-mono text-xs bg-green-50"
                              type="password"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copyToClipboard(revealedPrivateKeys.memo.private, 'memo private')}
                            >
                              {copiedKey === 'memo private' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {showPrivateKeys && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>SECURITY WARNING:</strong> Private keys are now visible. Never share them with anyone and ensure you're in a secure environment.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="recovery" className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  The recovery account can help you recover your account if you lose access. The reset account is part of the recovery process.
                </AlertDescription>
              </Alert>

              {/* Current Status */}
              <div className="grid gap-4">
                <div className="border rounded-lg p-4">
                  <Label className="font-semibold mb-2 block">Current Recovery Status</Label>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Recovery Account:</span>
                      <Badge variant="outline">
                        @{accountData?.recovery_account || 'steemit'}
                      </Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-600">Reset Account:</span>
                      <Badge variant={accountData?.reset_account === 'null' ? 'secondary' : 'outline'}>
                        {accountData?.reset_account === 'null' ? 'Not Set' : `@${accountData?.reset_account}`}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="currentResetAccount">Current Reset Account</Label>
                  <Input
                    id="currentResetAccount"
                    value={resetAccountData.currentResetAccount}
                    onChange={(e) => setResetAccountData({ ...resetAccountData, currentResetAccount: e.target.value })}
                    placeholder={accountData?.reset_account === 'null' ? 'Leave empty if none set' : accountData?.reset_account || ''}
                  />
                </div>

                <div>
                  <Label htmlFor="newResetAccount">New Reset Account</Label>
                  <Input
                    id="newResetAccount"
                    value={resetAccountData.newResetAccount}
                    onChange={(e) => setResetAccountData({ ...resetAccountData, newResetAccount: e.target.value })}
                    placeholder="Enter new reset account username"
                  />
                </div>

                <Button 
                  onClick={handleSetResetAccount}
                  disabled={isLoading}
                  className="w-full"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Setting Reset Account...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 mr-2" />
                      Set Reset Account
                    </>
                  )}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="password" className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This will generate a new secure password and keys for your account. This requires owner or active key access.
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="oldPassword">Current Password</Label>
                  <Input
                    id="oldPassword"
                    type="password"
                    value={passwordData.oldPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, oldPassword: e.target.value })}
                    placeholder="Enter current password"
                  />
                </div>

                {!passwordData.confirmReady ? (
                  <Button 
                    onClick={handleGenerateNewPassword}
                    disabled={isLoading}
                    className="w-full"
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Generating New Password...
                      </>
                    ) : (
                      <>
                        <Key className="w-4 h-4 mr-2" />
                        Generate New Password & Keys
                      </>
                    )}
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>IMPORTANT:</strong> Copy and save your new password and keys securely before confirming!
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">New Password</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          value={passwordData.newPassword}
                          readOnly
                          className="font-mono text-sm bg-yellow-50"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => copyToClipboard(passwordData.newPassword, 'new password')}
                        >
                          {copiedKey === 'new password' ? (
                            <Check className="w-4 h-4" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {generatedKeys && Object.entries(generatedKeys).map(([role, keys]: [string, any]) => (
                      <div key={role} className="space-y-2">
                        <Label className="text-sm font-medium capitalize">{role} Key</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            value={keys.private}
                            readOnly
                            className="font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => copyToClipboard(keys.private, `${role} private`)}
                          >
                            {copiedKey === `${role} private` ? (
                              <Check className="w-4 h-4" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                    ))}

                    <Button 
                      onClick={handleConfirmPasswordChange}
                      disabled={isLoading}
                      variant="destructive"
                      className="w-full"
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Updating Password...
                        </>
                      ) : (
                        'Confirm Password Change'
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default AccountSecurityOperations;
