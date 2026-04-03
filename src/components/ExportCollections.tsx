import { useState, useCallback } from "react";
import {
  ChevronLeft, Download, Loader2, FolderOpen, AlertTriangle,
  CheckCircle2, FileSpreadsheet, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  getConnection, getCustomCollections, getSmartCollections,
  type ShopifyCollection
} from "@/lib/shopify-api";
import Papa from "papaparse";

interface Props {
  onBack: () => void;
}

type ExportFormat = "csv" | "excel";
type FetchState = "idle" | "fetching" | "ready" | "error";

function collectionToRow(c: ShopifyCollection, type: "custom" | "smart") {
  const rulesStr = c.rules
    ? c.rules.map((r) => `${r.column} ${r.relation} ${r.condition}`).join(" | ")
    : "";
  const rulesColumn = c.rules ? c.rules.map((r) => r.column).join(", ") : "";
  const rulesCondition = c.rules ? c.rules.map((r) => r.condition).join(", ") : "";
  const rulesRelation = c.rules ? c.rules.map((r) => r.relation).join(", ") : "";

  return {
    "Shopify ID": c.id,
    Handle: c.handle,
    Title: c.title,
    "Body HTML": c.body_html || "",
    "Collection Type": type,
    "Image URL": c.image?.src || "",
    "SEO Title": "", // Shopify REST doesn't include metafields directly
    "SEO Description": "",
    "Sort Order": c.sort_order || "",
    "Published": c.published_at ? "Yes" : "No",
    "Template Suffix": c.template_suffix || "",
    "Created At": c.created_at,
    "Updated At": c.updated_at,
    "Rules (Summary)": rulesStr,
    "Rule Column": rulesColumn,
    "Rule Condition": rulesCondition,
    "Rule Relation": rulesRelation,
  };
}

const ExportCollections = ({ onBack }: Props) => {
  const [state, setState] = useState<FetchState>("idle");
  const [collections, setCollections] = useState<ShopifyCollection[]>([]);
  const [collectionTypes, setCollectionTypes] = useState<Map<number, "custom" | "smart">>(new Map());
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [format, setFormat] = useState<ExportFormat>("csv");

  const fetchCollections = useCallback(async () => {
    setState("fetching");
    setProgress(10);
    setErrorMsg("");

    try {
      const conn = await getConnection();
      if (!conn) {
        setErrorMsg("No Shopify connection found. Connect your store first.");
        setState("error");
        return;
      }

      setProgress(30);
      const [custom, smart] = await Promise.all([
        getCustomCollections(),
        getSmartCollections(),
      ]);

      setProgress(80);

      const typeMap = new Map<number, "custom" | "smart">();
      custom.forEach((c) => typeMap.set(c.id, "custom"));
      smart.forEach((c) => typeMap.set(c.id, "smart"));

      const all = [...custom, ...smart].sort((a, b) => a.title.localeCompare(b.title));
      setCollections(all);
      setCollectionTypes(typeMap);
      setProgress(100);
      setState("ready");
      toast.success(`Found ${all.length} collection${all.length !== 1 ? "s" : ""}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to fetch collections");
      setState("error");
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (collections.length === 0) return;

    const rows = collections.map((c) =>
      collectionToRow(c, collectionTypes.get(c.id) || "custom")
    );

    const csv = Papa.unparse(rows);
    const bom = format === "excel" ? "\uFEFF" : "";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shopify-collections-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Collections exported!");
  }, [collections, collectionTypes, format]);

  const customCount = collections.filter((c) => collectionTypes.get(c.id) === "custom").length;
  const smartCount = collections.filter((c) => collectionTypes.get(c.id) === "smart").length;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold font-display truncate">Export Collections</h1>
          <p className="text-[10px] text-muted-foreground">Back up & audit your Shopify collections</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-28">
        {/* Description */}
        <Card className="p-4 space-y-2">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            <h2 className="text-sm font-semibold">Shopify Collection Export</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Fetch all custom and smart collections from your Shopify store and export them as a clean CSV file. 
            Includes titles, handles, descriptions, images, rules, and publish status.
          </p>
        </Card>

        {/* Fetch Button */}
        {state === "idle" && (
          <Button className="w-full h-12 text-base" onClick={fetchCollections}>
            <RefreshCw className="w-5 h-5 mr-2" /> Fetch Collections
          </Button>
        )}

        {/* Fetching state */}
        {state === "fetching" && (
          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium">
                  {progress < 30 ? "Connecting to Shopify…" : progress < 80 ? "Fetching collections…" : "Preparing export…"}
                </p>
                <p className="text-[10px] text-muted-foreground">This may take a moment for large stores</p>
              </div>
            </div>
            <Progress value={progress} className="h-2" />
          </Card>
        )}

        {/* Error state */}
        {state === "error" && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm font-medium">Error</p>
            </div>
            <p className="text-xs text-muted-foreground">{errorMsg}</p>
            <Button variant="outline" onClick={fetchCollections}>
              <RefreshCw className="w-4 h-4 mr-2" /> Retry
            </Button>
          </Card>
        )}

        {/* Ready state */}
        {state === "ready" && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="p-3 text-center">
                <p className="text-2xl font-bold text-primary">{collections.length}</p>
                <p className="text-[10px] text-muted-foreground">Total</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{customCount}</p>
                <p className="text-[10px] text-muted-foreground">Custom</p>
              </Card>
              <Card className="p-3 text-center">
                <p className="text-2xl font-bold text-foreground">{smartCount}</p>
                <p className="text-[10px] text-muted-foreground">Smart</p>
              </Card>
            </div>

            {/* Collection list preview */}
            <Card className="p-3 space-y-2">
              <h3 className="text-xs font-semibold">Collections Found</h3>
              <div className="max-h-52 overflow-y-auto space-y-1">
                {collections.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs py-1.5 px-2 rounded-lg bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{c.title}</p>
                      <p className="text-[10px] text-muted-foreground truncate">/{c.handle}</p>
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                      collectionTypes.get(c.id) === "smart"
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {collectionTypes.get(c.id)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* Format selector */}
            <div className="flex gap-2">
              <Button
                variant={format === "csv" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setFormat("csv")}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> CSV
              </Button>
              <Button
                variant={format === "excel" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setFormat("excel")}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1" /> Excel-Ready CSV
              </Button>
            </div>

            {/* Download */}
            <Button className="w-full h-12 text-base font-semibold" onClick={handleDownload}>
              <Download className="w-5 h-5 mr-2" />
              Download {format === "excel" ? "Excel-Ready " : ""}CSV ({collections.length} collection{collections.length !== 1 ? "s" : ""})
            </Button>

            {/* Refresh */}
            <Button variant="ghost" className="w-full" onClick={fetchCollections}>
              <RefreshCw className="w-4 h-4 mr-2" /> Re-fetch Collections
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default ExportCollections;
