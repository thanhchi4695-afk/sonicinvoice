import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { useMediaQuery } from "@/hooks/use-media-query";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  // Lift toasts above the mobile bottom tab bar (h-16 + safe-area).
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const mobileOffset = "calc(4rem + env(safe-area-inset-bottom, 0px) + 0.75rem)";

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      offset={isDesktop ? undefined : mobileOffset}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
