import { Link, useLocation } from "react-router-dom";
import { useEffect, useMemo } from "react";
import { ArrowRight, Home, LifeBuoy, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Branded 404 page.
 *
 * Special-cases auth-style paths (e.g. /login, /signin, /sign-in, /log-in,
 * /auth, /signup, /sign-up, /register) so users who land here from an old
 * link, a typo, or a stale bookmark get a one-click route to the real
 * sign-in entrypoint at /login instead of a dead end.
 */
const AUTH_PATH_PATTERN = /^\/(log[-_ ]?in|sign[-_ ]?in|signin|login|auth|sign[-_ ]?up|signup|register|account\/login)\/?$/i;

const NotFound = () => {
  const location = useLocation();

  const isAuthPath = useMemo(
    () => AUTH_PATH_PATTERN.test(location.pathname),
    [location.pathname]
  );

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname,
      isAuthPath ? "(detected as auth path — suggesting /login)" : ""
    );
  }, [location.pathname, isAuthPath]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between max-w-6xl w-full mx-auto px-6 py-5">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-lg font-bold font-display">Sonic Invoice</span>
          <span className="text-[10px] text-muted-foreground border border-border rounded-full px-2 py-0.5">
            sonicinvoices.com
          </span>
        </Link>
        <Link to="/login">
          <Button variant="ghost" size="sm">Sign in</Button>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-xl w-full text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-3">
            Error 404
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold font-display mb-4 leading-tight">
            {isAuthPath ? "Looking for sign in?" : "Page not found"}
          </h1>
          <p className="text-base text-muted-foreground mb-8 leading-relaxed">
            {isAuthPath ? (
              <>
                The page <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-sm">{location.pathname}</code>{" "}
                doesn't exist on this site. Our sign-in lives at{" "}
                <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-sm">/login</code>.
              </>
            ) : (
              <>
                We couldn't find <code className="px-1.5 py-0.5 rounded bg-muted text-foreground text-sm">{location.pathname}</code>.
                It may have moved, or the link might be out of date.
              </>
            )}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-10">
            {isAuthPath ? (
              <>
                <Link to="/login" className="w-full sm:w-auto">
                  <Button variant="teal" size="lg" className="w-full sm:w-auto gap-2">
                    <LogIn className="w-4 h-4" />
                    Go to sign in
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </Link>
                <Link to="/" className="w-full sm:w-auto">
                  <Button variant="outline" size="lg" className="w-full sm:w-auto gap-2">
                    <Home className="w-4 h-4" />
                    Home
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Link to="/" className="w-full sm:w-auto">
                  <Button variant="teal" size="lg" className="w-full sm:w-auto gap-2">
                    <Home className="w-4 h-4" />
                    Back to home
                  </Button>
                </Link>
                <Link to="/login" className="w-full sm:w-auto">
                  <Button variant="outline" size="lg" className="w-full sm:w-auto gap-2">
                    <LogIn className="w-4 h-4" />
                    Sign in
                  </Button>
                </Link>
              </>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            Still stuck?{" "}
            <Link
              to="/support"
              className="inline-flex items-center gap-1 text-foreground underline underline-offset-4 hover:text-primary"
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              Contact support
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Sonic Invoice · sonicinvoices.com</span>
          <div className="flex items-center gap-4">
            <Link to="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link to="/support" className="hover:text-foreground">Support</Link>
            <Link to="/login" className="hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default NotFound;
