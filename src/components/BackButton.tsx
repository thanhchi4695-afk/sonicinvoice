import { ArrowLeft } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BackButtonProps {
  to?: string;
  label?: string;
  className?: string;
}

/**
 * Unified back button used across tool pages.
 * - If `to` is provided, navigates via <Link>.
 * - Otherwise uses browser history (falls back to /dashboard).
 */
export function BackButton({ to, label = "Back to dashboard", className }: BackButtonProps) {
  const navigate = useNavigate();

  const content = (
    <>
      <ArrowLeft className="h-4 w-4 mr-2" />
      {label}
    </>
  );

  if (to) {
    return (
      <Button asChild variant="ghost" size="sm" className={cn("-ml-2", className)}>
        <Link to={to}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-2", className)}
      onClick={() => {
        if (window.history.length > 1) navigate(-1);
        else navigate("/dashboard");
      }}
    >
      {content}
    </Button>
  );
}

export default BackButton;
