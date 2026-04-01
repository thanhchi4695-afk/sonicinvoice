import { useState } from "react";
import { Button } from "@/components/ui/button";

interface AuthScreenProps {
  onAuth: () => void;
}

const AuthScreen = ({ onAuth }: AuthScreenProps) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [storeName, setStoreName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAuth();
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 animate-fade-in">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold font-display text-center mb-1">SkuPilot</h1>
        <p className="text-muted-foreground text-sm text-center mb-8">Invoice → Shopify in minutes</p>

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

          <Button variant="teal" className="w-full h-12 text-base" type="submit">
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>

        {!isSignUp && (
          <button className="w-full mt-3 text-xs text-muted-foreground text-center">Forgot password?</button>
        )}

        <button onClick={() => setIsSignUp(!isSignUp)} className="w-full mt-6 text-sm text-primary text-center font-medium">
          {isSignUp ? "Already have an account? Sign in" : "New to SkuPilot? Create account"}
        </button>
      </div>
    </div>
  );
};

export default AuthScreen;
