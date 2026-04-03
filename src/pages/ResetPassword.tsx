import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Password reset page — shown when user clicks the reset link from email.
 * Must be mounted at /reset-password route.
 */
const ResetPassword = () => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated successfully");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="text-4xl mb-4">✅</div>
          <h1 className="text-2xl font-bold font-display mb-2">Password Updated</h1>
          <p className="text-muted-foreground text-sm mb-6">You can now sign in with your new password.</p>
          <Button variant="teal" className="w-full h-12" onClick={() => window.location.href = "/"}>
            Go to Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold font-display text-center mb-1">Set New Password</h1>
        <p className="text-muted-foreground text-sm text-center mb-6">Enter your new password below.</p>
        <form onSubmit={handleReset} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" className="w-full h-12 rounded-lg bg-input border border-border px-4 text-sm" required minLength={6} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Confirm password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••" className="w-full h-12 rounded-lg bg-input border border-border px-4 text-sm" required minLength={6} />
          </div>
          <Button variant="teal" className="w-full h-12 text-base" type="submit" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Update Password
          </Button>
        </form>
      </div>
    </div>
  );
};

export default ResetPassword;
