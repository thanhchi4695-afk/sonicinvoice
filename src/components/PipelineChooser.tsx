import { ChevronRight } from "lucide-react";
import { PIPELINES, Pipeline } from "@/lib/pipeline-definitions";

interface PipelineChooserProps {
  onSelect: (pipelineId: string) => void;
  onBack: () => void;
}

const PipelineChooser = ({ onSelect, onBack }: PipelineChooserProps) => {
  return (
    <div className="px-4 pt-2 pb-24 animate-fade-in">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground mb-3">← Back</button>
      <h1 className="text-xl font-bold font-display mb-1">Automation pipelines</h1>
      <p className="text-sm text-muted-foreground mb-5">
        Guided multi-step sequences — go from invoice to live products, SEO, and ads.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {PIPELINES.map((p) => (
          <PipelineCard key={p.id} pipeline={p} onSelect={onSelect} />
        ))}
      </div>

      <button onClick={onBack} className="mt-6 text-xs text-primary hover:underline">
        Or start a single tool →
      </button>
    </div>
  );
};

function PipelineCard({ pipeline, onSelect }: { pipeline: Pipeline; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(pipeline.id)}
      className="bg-card border border-border rounded-xl p-4 text-left hover:border-primary/40 transition-colors flex flex-col justify-between"
    >
      <div>
        <span className="text-2xl block mb-2">{pipeline.emoji}</span>
        <p className="text-sm font-semibold leading-tight">{pipeline.name}</p>
        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{pipeline.desc}</p>
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-[10px] text-muted-foreground">~{pipeline.estimatedMinutes} min · {pipeline.steps.length} steps</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
    </button>
  );
}

export default PipelineChooser;
