import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Upload, FileText, CheckCircle2, AlertCircle, Loader2, Trash2, Eye, Save, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SupplierProfileBuilderProps {
  onBack: () => void;
}

interface UploadedInvoice {
  fileName: string;
  base64: string;
  fileType: string;
}

interface ColumnMapping {
  header: string;
  position: string;
  notes: string;
}

interface ProfileExample {
  raw_line: string;
  extracted: {
    style_code?: string;
    product_name?: string;
    colour?: string;
    sizes?: string[];
    unit_cost?: number;
    quantity?: number;
  };
}

interface SupplierProfile {
  supplier: string;
  invoice_layout: string;
  layout_description: string;
  column_mappings: Record<string, ColumnMapping>;
  product_name_rules: string;
  colour_rules: string;
  colour_abbreviations: Record<string, string>;
  size_rules: string;
  variant_detection_rule: string;
  size_system: string;
  gst_handling: string;
  currency: string;
  pricing_notes: string;
  noise_patterns: string[];
  quirks: string[];
  examples: ProfileExample[];
  confidence_notes: string;
  extraction_tips: string;
}

type Step = "upload" | "analysing" | "review" | "saved";

const SupplierProfileBuilder = ({ onBack }: SupplierProfileBuilderProps) => {
  const [step, setStep] = useState<Step>("upload");
  const [invoices, setInvoices] = useState<UploadedInvoice[]>([]);
  const [profile, setProfile] = useState<SupplierProfile | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newInvoices: UploadedInvoice[] = [];
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase() || "";
      const validTypes = ["pdf", "jpg", "jpeg", "png", "webp"];
      if (!validTypes.includes(ext)) {
        toast.error(`Skipped ${file.name} — unsupported format`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`Skipped ${file.name} — max 10MB`);
        continue;
      }
      const base64 = await fileToBase64(file);
      newInvoices.push({
        fileName: file.name,
        base64,
        fileType: ext === "jpg" ? "jpeg" : ext,
      });
    }
    setInvoices(prev => [...prev, ...newInvoices]);
    e.target.value = "";
  }, []);

  const removeInvoice = (idx: number) => {
    setInvoices(prev => prev.filter((_, i) => i !== idx));
  };

  const startAnalysis = async () => {
    if (invoices.length < 2) {
      toast.error("Upload at least 2 invoices from the same supplier");
      return;
    }

    setStep("analysing");
    setError(null);
    setAnalysisProgress(10);

    const progressInterval = setInterval(() => {
      setAnalysisProgress(prev => Math.min(prev + 8, 85));
    }, 2000);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("build-supplier-profile", {
        body: { invoices },
      });

      clearInterval(progressInterval);

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      setProfile(data.profile);
      setAnalysisProgress(100);
      setTimeout(() => setStep("review"), 500);
    } catch (err) {
      clearInterval(progressInterval);
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStep("upload");
      toast.error("Profile generation failed — try again");
    }
  };

  const saveProfile = async () => {
    if (!profile) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error("Please sign in first"); return; }

      const { error: upsertErr } = await supabase
        .from("supplier_profiles")
        .upsert({
          user_id: user.id,
          supplier_name: profile.supplier,
          profile_data: profile as unknown as Record<string, unknown>,
          invoices_analysed: invoices.length,
          is_active: true,
        }, { onConflict: "user_id,supplier_name" });

      if (upsertErr) throw upsertErr;

      setStep("saved");
      toast.success(`Profile saved for ${profile.supplier}`);
    } catch (err) {
      toast.error("Failed to save profile");
    }
  };

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h2 className="text-lg font-bold">Supplier Profile Builder</h2>
          <p className="text-xs text-muted-foreground">Upload multiple invoices to train AI for this supplier</p>
        </div>
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Upload Invoices (same supplier)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Upload 2–10 invoices from the same supplier. The AI will analyse them together to learn the layout, column mappings, naming patterns, and quirks.
              </p>
              <label className="block cursor-pointer border-2 border-dashed border-border rounded-lg p-6 text-center hover:border-primary/50 transition-colors">
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden" onChange={handleFileUpload} />
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Drop invoices here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG • Max 10MB each</p>
              </label>
            </CardContent>
          </Card>

          {invoices.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{invoices.length} invoice{invoices.length !== 1 ? "s" : ""} ready</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {invoices.map((inv, i) => (
                  <div key={i} className="flex items-center justify-between bg-muted/50 rounded px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-xs truncate">{inv.fileName}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">{inv.fileType.toUpperCase()}</Badge>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeInvoice(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button className="w-full mt-2" onClick={startAnalysis} disabled={invoices.length < 2}>
                  <Layers className="h-4 w-4 mr-2" />
                  Analyse {invoices.length} Invoices & Build Profile
                </Button>
                {invoices.length < 2 && (
                  <p className="text-xs text-muted-foreground text-center">Upload at least 2 invoices to continue</p>
                )}
              </CardContent>
            </Card>
          )}

          {error && (
            <Card className="border-destructive/50">
              <CardContent className="py-3">
                <p className="text-xs text-destructive flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Step: Analysing */}
      {step === "analysing" && (
        <Card>
          <CardContent className="py-8 space-y-4 text-center">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-primary" />
            <div>
              <p className="text-sm font-medium">Analysing {invoices.length} invoices…</p>
              <p className="text-xs text-muted-foreground mt-1">AI is detecting layout patterns, column mappings, and supplier quirks</p>
            </div>
            <Progress value={analysisProgress} className="h-2 max-w-xs mx-auto" />
            <p className="text-xs text-muted-foreground">{analysisProgress}%</p>
          </CardContent>
        </Card>
      )}

      {/* Step: Review */}
      {step === "review" && profile && (
        <div className="space-y-3">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <span className="font-bold text-sm">{profile.supplier}</span>
                <Badge variant="outline" className="text-[10px]">{profile.invoice_layout}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{profile.layout_description}</p>
            </CardContent>
          </Card>

          {/* Column Mappings */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Column Mappings</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                {Object.entries(profile.column_mappings).map(([key, val]) => (
                  <div key={key} className="flex justify-between items-start text-xs bg-muted/30 rounded px-2 py-1.5">
                    <span className="font-medium text-foreground capitalize">{key.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground text-right max-w-[60%]">
                      {typeof val === "object" && val ? `${(val as ColumnMapping).header} (${(val as ColumnMapping).position})` : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Rules */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Extraction Rules</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                ["Product Name", profile.product_name_rules],
                ["Colour", profile.colour_rules],
                ["Size", profile.size_rules],
                ["Variant Detection", profile.variant_detection_rule],
                ["Size System", profile.size_system],
                ["GST Handling", profile.gst_handling],
                ["Pricing", profile.pricing_notes],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label as string} className="text-xs">
                  <span className="font-medium">{label}: </span>
                  <span className="text-muted-foreground">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Colour abbreviations */}
          {profile.colour_abbreviations && Object.keys(profile.colour_abbreviations).length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Colour Abbreviations</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(profile.colour_abbreviations).map(([abbr, full]) => (
                    <Badge key={abbr} variant="outline" className="text-[10px]">{abbr} → {full}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Examples */}
          {profile.examples?.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" /> Examples</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {profile.examples.slice(0, 3).map((ex, i) => (
                  <div key={i} className="bg-muted/30 rounded p-2 text-xs space-y-1">
                    <p className="text-muted-foreground italic truncate">"{ex.raw_line}"</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ex.extracted?.style_code && <Badge variant="secondary" className="text-[10px]">SKU: {ex.extracted.style_code}</Badge>}
                      {ex.extracted?.product_name && <Badge variant="secondary" className="text-[10px]">{ex.extracted.product_name}</Badge>}
                      {ex.extracted?.colour && <Badge variant="outline" className="text-[10px]">{ex.extracted.colour}</Badge>}
                      {ex.extracted?.sizes && <Badge variant="outline" className="text-[10px]">Sizes: {ex.extracted.sizes.join(", ")}</Badge>}
                      {ex.extracted?.unit_cost != null && <Badge variant="outline" className="text-[10px]">${ex.extracted.unit_cost}</Badge>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Quirks & Noise */}
          {(profile.quirks?.length > 0 || profile.noise_patterns?.length > 0) && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Supplier Quirks & Noise</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {profile.quirks?.map((q, i) => (
                  <p key={i} className="text-xs text-muted-foreground">⚡ {q}</p>
                ))}
                {profile.noise_patterns?.map((n, i) => (
                  <p key={i} className="text-xs text-muted-foreground">🚫 {n}</p>
                ))}
              </CardContent>
            </Card>
          )}

          {profile.confidence_notes && (
            <Card>
              <CardContent className="py-3">
                <p className="text-xs text-muted-foreground">
                  <AlertCircle className="h-3 w-3 inline mr-1" />
                  {profile.confidence_notes}
                </p>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setStep("upload"); setProfile(null); }}>
              Re-analyse
            </Button>
            <Button className="flex-1" onClick={saveProfile}>
              <Save className="h-4 w-4 mr-2" />
              Save Profile
            </Button>
          </div>
        </div>
      )}

      {/* Step: Saved */}
      {step === "saved" && profile && (
        <Card className="border-primary/30">
          <CardContent className="py-8 text-center space-y-3">
            <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
            <div>
              <p className="font-bold">{profile.supplier} Profile Saved</p>
              <p className="text-xs text-muted-foreground mt-1">
                Analysed {invoices.length} invoices • Future extractions will use this profile automatically
              </p>
            </div>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => { setStep("upload"); setInvoices([]); setProfile(null); }}>
                Build Another
              </Button>
              <Button size="sm" onClick={onBack}>Done</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default SupplierProfileBuilder;
