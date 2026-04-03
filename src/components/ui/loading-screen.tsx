import { useEffect, useState } from "react";
import { Zap } from "lucide-react";

interface LoadingScreenProps {
  title?: string;
  messages?: string[];
  /** Cycle through messages every N ms */
  interval?: number;
}

const LoadingScreen = ({
  title = "Loading...",
  messages = [],
  interval = 2000,
}: LoadingScreenProps) => {
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (messages.length <= 1) return;
    const t = setInterval(() => setMsgIdx((i) => (i + 1) % messages.length), interval);
    return () => clearInterval(t);
  }, [messages.length, interval]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-5">
        {/* Lightning bolt with pulse ring */}
        <div className="relative mx-auto w-16 h-16">
          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
          <div className="absolute inset-1 rounded-full bg-primary/10 animate-pulse" />
          <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/20">
            <Zap className="w-7 h-7 text-primary animate-pulse" fill="currentColor" />
          </div>
        </div>

        <h2 className="text-lg font-bold text-foreground">{title}</h2>

        {messages.length > 0 && (
          <p
            key={msgIdx}
            className="text-sm text-muted-foreground animate-fade-in"
          >
            {messages[msgIdx]}
          </p>
        )}

        {/* Speed bar */}
        <div className="w-48 mx-auto h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-primary to-primary/40 animate-loading-bar" />
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
