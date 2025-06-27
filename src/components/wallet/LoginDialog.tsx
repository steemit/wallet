
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { LogIn, Wallet, Lock, Eye, EyeOff, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import * as dsteem from 'dsteem';

interface LoginDialogProps {
  children: React.ReactNode;
  onLoginSuccess: (username: string, loginMethod: 'keychain' | 'privatekey' | 'masterpassword') => void;
}

declare global {
  interface Window {
    steem_keychain: any;
  }
}

const LoginDialog = ({ children, onLoginSuccess }: LoginDialogProps) => {
  const [username, setUsername] = useState("");
  const [credential, setCredential] = useState("");
  const [useKeychain, setUseKeychain] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isLogging, setIsLogging] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleLogin = () => {
    if (!username) {
      toast({
        title: "Missing Username",
        description: "Please provide your username",
        variant: "destructive",
      });
      return;
    }

    if (useKeychain) {
      handleKeychainLogin();
    } else {
      if (!credential) {
        toast({
          title: "Missing Credential",
          description: "Please provide your private key or master password",
          variant: "destructive",
        });
        return;
      }
      handleCredentialLogin();
    }
  };

  const handleCredentialLogin = () => {
    setIsLogging(true);
    
    try {
      // Check if it's a private key (starts with '5')
      if (credential.startsWith('5')) {
        // Handle as private key
        localStorage.setItem('steem_username', username);
        localStorage.setItem('steem_active_key', credential);
        localStorage.setItem('steem_login_method', 'privatekey');
        
        toast({
          title: "Login Successful",
          description: `Logged in as @${username} with Private Key`,
        });
        
        onLoginSuccess(username, 'privatekey');
      } else {
        // Handle as master password
        const activeKey = dsteem.PrivateKey.fromLogin(username, credential, 'active');
        
        localStorage.setItem('steem_username', username);
        localStorage.setItem('steem_active_key', activeKey.toString());
        localStorage.setItem('steem_login_method', 'masterpassword');
        
        toast({
          title: "Login Successful",
          description: `Logged in as @${username} with Master Password`,
        });
        
        onLoginSuccess(username, 'masterpassword');
      }
      
      setIsOpen(false);
      setUsername("");
      setCredential("");
    } catch (error) {
      toast({
        title: "Login Failed",
        description: "Invalid credentials. Please check your private key or master password.",
        variant: "destructive",
      });
    } finally {
      setIsLogging(false);
    }
  };

  const handleKeychainLogin = () => {
    if (typeof window !== 'undefined' && window.steem_keychain) {
      setIsLogging(true);
      
      // First, check if Keychain is available
      window.steem_keychain.requestHandshake(() => {
        console.log('Keychain handshake successful');
        
        // Now request message signing for authentication
        const loginMessage = `Login to Steem Wallet\nUsername: ${username}\nTimestamp: ${Date.now()}`;
        
        window.steem_keychain.requestSignBuffer(
          username,
          loginMessage,
          'Posting',
          (response: any) => {
            console.log('Keychain sign response:', response);
            
            if (response.success) {
              // Authentication successful
              localStorage.setItem('steem_username', username);
              localStorage.setItem('steem_login_method', 'keychain');
              localStorage.setItem('steem_keychain_signature', response.result);
              
              toast({
                title: "Keychain Authentication Successful",
                description: `Successfully authenticated as @${username} via Steem Keychain`,
              });
              
              onLoginSuccess(username, 'keychain');
              setIsOpen(false);
              setUsername("");
              setIsLogging(false);
            } else {
              console.error('Keychain authentication failed:', response);
              toast({
                title: "Authentication Failed",
                description: response.message || "Failed to authenticate with Keychain. Please try again.",
                variant: "destructive",
              });
              setIsLogging(false);
            }
          }
        );
      });
    } else {
      toast({
        title: "Keychain Not Found",
        description: "Please install Steem Keychain browser extension",
        variant: "destructive",
      });
      setIsLogging(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('steem_username');
    localStorage.removeItem('steem_active_key');
    localStorage.removeItem('steem_login_method');
    localStorage.removeItem('steem_keychain_signature');
    
    // Redirect to homepage after logout
    navigate('/');
    
    toast({
      title: "Logged Out",
      description: "Successfully logged out from Steem",
    });
    
    // Reload the page to refresh the state
    window.location.reload();
  };

  // Check if user is already logged in
  const isLoggedIn = localStorage.getItem('steem_username');

  if (isLoggedIn) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-600">@{isLoggedIn}</span>
        <Button 
          onClick={handleLogout}
          variant="outline"
          size="sm"
          className="text-red-600 border-red-200 hover:bg-red-50"
        >
          <LogOut className="w-4 h-4 mr-1" />
          Logout
        </Button>
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="bg-white max-w-md border-0 shadow-2xl">
        <DialogHeader className="text-center pb-2">
          <DialogTitle className="flex items-center justify-center gap-3 text-xl" style={{ color: '#07d7a9' }}>
            <div className="p-2 rounded-full" style={{ backgroundColor: '#07d7a915' }}>
              <LogIn className="w-6 h-6" />
            </div>
            Steemit Wallet Login
          </DialogTitle>
          <DialogDescription className="text-gray-600">
            Access your Steem wallet securely. Your credentials never leave your browser.
          </DialogDescription>
        </DialogHeader>
        
        <Card className="border-0 shadow-none bg-gradient-to-br from-gray-50 to-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg text-center text-gray-800">
              Premium Access
            </CardTitle>
            <CardDescription className="text-center text-gray-600">
              Connect with your preferred authentication method
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-sm font-medium text-gray-700">
                Username
              </Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="border-gray-300 focus:border-[#07d7a9] focus:ring-[#07d7a9] transition-colors"
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="keychain" 
                  checked={useKeychain}
                  onCheckedChange={(checked) => setUseKeychain(checked as boolean)}
                  className="data-[state=checked]:bg-[#07d7a9] data-[state=checked]:border-[#07d7a9]"
                />
                <Label htmlFor="keychain" className="text-sm font-medium text-gray-700 flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  Use Steem Keychain (Recommended)
                </Label>
              </div>

              {!useKeychain && (
                <div className="space-y-2">
                  <Label htmlFor="credential" className="text-sm font-medium text-gray-700 flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    Private Key or Master Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="credential"
                      type={showCredential ? "text" : "password"}
                      value={credential}
                      onChange={(e) => setCredential(e.target.value)}
                      placeholder="5K... (private key) or master password"
                      className="border-gray-300 focus:border-[#07d7a9] focus:ring-[#07d7a9] transition-colors pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowCredential(!showCredential)}
                    >
                      {showCredential ? (
                        <EyeOff className="h-4 w-4 text-gray-400" />
                      ) : (
                        <Eye className="h-4 w-4 text-gray-400" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500">
                    Enter your private active key (5K...) or master password. 
                    The system will automatically detect which one you're using.
                  </p>
                </div>
              )}

              {useKeychain && (
                <div className="text-center py-6">
                  <div className="p-4 rounded-full mx-auto w-16 h-16 flex items-center justify-center" style={{ backgroundColor: '#07d7a915' }}>
                    <Wallet className="w-8 h-8" style={{ color: '#07d7a9' }} />
                  </div>
                  <p className="text-sm text-gray-600 mt-3">
                    Click login to authenticate with Steem Keychain. You'll be asked to sign a message to verify your identity.
                  </p>
                </div>
              )}
            </div>

            <Button 
              onClick={handleLogin}
              className="w-full text-white font-medium py-3 transition-all hover:shadow-lg"
              style={{ backgroundColor: '#07d7a9' }}
              disabled={!username || (!useKeychain && !credential) || isLogging}
            >
              {isLogging ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  {useKeychain ? "Authenticating..." : "Logging in..."}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {useKeychain ? <Wallet className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  {useKeychain ? "Authenticate with Keychain" : "Login"}
                </div>
              )}
            </Button>

            <div className="text-center">
              <p className="text-xs text-gray-500">
                🔒 Your credentials are stored locally and never transmitted to any server
              </p>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default LoginDialog;
