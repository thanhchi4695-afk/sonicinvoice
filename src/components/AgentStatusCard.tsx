import { Link } from "react-router-dom";
import { Zap } from "lucide-react";

function formatYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function AgentStatusCard() {
  return (
    <div className="mx-4 my-4 rounded-xl border border-lime/40 bg-[#141414] p-5 shadow-[0_0_0_1px_rgba(163,230,53,0.08)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-lime" />
          <span className="text-[14px] font-medium text-[#fafafa]">Sonic Agent</span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-lime/10 border border-lime/30">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-lime opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-lime" />
          </span>
          <span className="text-[11px] font-mono text-lime">Live</span>
        </div>
      </div>

      <div className="space-y-1.5 mb-4">
        <p className="text-[13px] text-lime">14 automated flows active</p>
        <p className="text-[12px] text-[#a3a3a3]">Next run: tonight at 2:00 AM Darwin time</p>
        <p className="text-[12px] text-[#a3a3a3]">Last run: {formatYesterday()} — 0 errors</p>
      </div>

      <Link
        to="/agent"
        className="inline-flex items-center gap-1.5 border border-lime/30 text-lime text-sm rounded-lg px-4 py-2 hover:bg-lime/10 transition-colors"
      >
        View agent log →
      </Link>
    </div>
  );
}
