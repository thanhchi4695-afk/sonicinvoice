import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { initiateShopifyLogin } from "@/lib/shopify-auth";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

interface AuthScreenProps {
  onAuth: () => void;
}

const AuthScreen = ({ onAuth }: AuthScreenProps) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [shopifyShop, setShopifyShop] = useState("");
  const [showShopifyLogin, setShowShopifyLogin] = useState(false);
  const [shopifyLoading, setShopifyLoading] = useState(false);
  const [shopifyError, setShopifyError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error instanceof Error ? result.error.message : "Google sign-in failed");
        setGoogleLoading(false);
        return;
      }
      if (result.redirected) return;
      // Session set by lovable auth
      onAuth();
    } catch (err) {
      toast.error("Google sign-in failed");
      setGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        // Real Supabase sign up
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { store_name: storeName },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (data.user && !data.session) {
          toast.success("Check your email to confirm your account");
        } else if (data.session) {
          toast.success("Account created successfully");
          onAuth();
        }
      } else {
        // Real Supabase sign in
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        if (data.session) {
          onAuth();
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      toast.success("Password reset link sent to your email");
      setShowForgotPassword(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reset email");
    } finally {
      setForgotLoading(false);
    }
  };

  const handleShopifyLogin = async () => {
    const shop = shopifyShop.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!shop) {
      setShopifyError("Please enter your Shopify store URL");
      return;
    }
    const fullShop = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;

    setShopifyLoading(true);
    setShopifyError("");
    try {
      const installUrl = await initiateShopifyLogin(fullShop);
      window.location.href = installUrl;
    } catch (err) {
      setShopifyError(err instanceof Error ? err.message : "Failed to connect");
      setShopifyLoading(false);
    }
  };

  // Forgot password form
  if (showForgotPassword) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 animate-fade-in">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold font-display text-center mb-1">Reset Password</h1>
          <p className="text-muted-foreground text-sm text-center mb-6">
            Enter your email and we'll send a reset link.
          </p>
          <form onSubmit={handleForgotPassword} className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email</label>
              <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                placeholder="you@store.com" className="w-full h-12 rounded-lg bg-input border border-border px-4 text-sm" required />
            </div>
            <Button variant="teal" className="w-full h-12 text-base" type="submit" disabled={forgotLoading}>
              {forgotLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Send reset link
            </Button>
          </form>
          <button onClick={() => setShowForgotPassword(false)} className="w-full mt-4 text-sm text-primary text-center font-medium">
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold font-display text-center mb-1">Sonic Invoice</h1>
        <p className="text-muted-foreground text-sm text-center mb-8">Invoice → Shopify in minutes</p>

        {/* Shopify OAuth Login */}
        <div className="mb-6">
          {!showShopifyLogin ? (
            <Button
              variant="outline"
              className="w-full h-12 text-base gap-2 border-[#96bf48] text-[#96bf48] hover:bg-[#96bf48]/10"
              onClick={() => setShowShopifyLogin(true)}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.337 3.415c-.15-.075-.3-.03-.375.09-.06.105-1.005 1.935-1.005 1.935s-1.11-.39-1.215-.42c-.03-.015-.06-.015-.09-.015C12.477 4.62 12.045 3 11.91 2.58c-.045-.12-.075-.195-.105-.24-.315-.465-.735-.51-.93-.51h-.045C10.56 1.83 10.29 2.1 10.14 2.37c-.39.69-.93 1.77-.93 1.77L7.5 3.57c-.15-.045-.255-.015-.315.09-.075.135-1.635 3.975-1.635 3.975L3.885 18.09l10.545 1.905 5.64-1.245S15.472 3.49 15.337 3.415z" />
              </svg>
              Sign in with Shopify
            </Button>
          ) : (
            <div className="space-y-3 p-4 rounded-lg border border-[#96bf48]/30 bg-[#96bf48]/5">
              <p className="text-xs text-muted-foreground">Enter your Shopify store URL to sign in:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={shopifyShop}
                  onChange={(e) => { setShopifyShop(e.target.value); setShopifyError(""); }}
                  placeholder="yourstore.myshopify.com"
                  className="flex-1 h-10 rounded-lg bg-input border border-border px-3 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && handleShopifyLogin()}
                />
              </div>
              {shopifyError && <p className="text-xs text-destructive">{shopifyError}</p>}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setShowShopifyLogin(false); setShopifyError(""); }}
                  className="text-xs"
                >
                  Cancel
                </Button>
                <Button
                  variant="teal"
                  size="sm"
                  className="flex-1"
                  onClick={handleShopifyLogin}
                  disabled={shopifyLoading}
                >
                  {shopifyLoading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Connect & Sign in
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                This will install Sonic Invoice on your Shopify store and sign you in automatically.
                Your store data stays private.
              </p>
            </div>
          )}
        </div>

        {/* Google OAuth Login */}
        <Button
          variant="outline"
          className="w-full h-12 text-base gap-2 mb-3"
          onClick={handleGoogleLogin}
          disabled={googleLoading}
        >
          {googleLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          )}
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">or use email</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {isSignUp && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Store name</label>
              <input type="text" value={storeName} onChange={(e) => setStoreName(e.target.value)}
                placeholder="My Boutique" className="w-full h-12 rounded-lg bg-input border border-border px-4 text-sm" required />
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@store.com" className="w-full h-12 rounded-lg bg-input border border-border px-4 text-sm" required />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" className="w-full h-12 rounded-lg bg-input border border-border px-4 text-sm" required />
          </div>

          <Button variant="teal" className="w-full h-12 text-base" type="submit" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        {!isSignUp && (
          <button
            onClick={() => setShowForgotPassword(true)}
            className="w-full mt-3 text-xs text-muted-foreground text-center hover:text-foreground transition-colors"
          >
            Forgot password?
          </button>
        )}

        <button onClick={() => setIsSignUp(!isSignUp)} className="w-full mt-6 text-sm text-primary text-center font-medium">
          {isSignUp ? "Already have an account? Sign in" : "New to Sonic Invoice? Create account"}
        </button>
      </div>
    </div>
  );
};

export default AuthScreen;
