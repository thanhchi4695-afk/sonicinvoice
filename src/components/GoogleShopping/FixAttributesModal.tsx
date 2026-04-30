/**
 * FixAttributesModal
 *
 * Allows merchants to fix missing Google Shopping attributes for one or many
 * products. Renders only fields that are currently missing per product, with
 * optional "bulk apply" mode that sets the same value across every selected
 * product.
 *
 * Validation:
 *   gender    ∈ { male, female, unisex }
 *   age_group ∈ { newborn, infant, toddler, kids, adult }
 *   color, material, pattern, condition, google_product_category: non-empty
 *   size (variant-level): non-empty
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Wand2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  updateProductFeedAttributes,
  type GoogleFeedAttributes,
  type VariantSize,
} from "@/lib/shopify/productFeedEnricher";

// ───────────────────────────── Types ─────────────────────────────

export interface VariantInput {
  variantId: string;
  title?: string | null;
  size: string | null;
}

export interface ProductFixInput {
  productId: string;
  title: string;
  gender: string | null;
  ageGroup: string | null;
  color: string | null;
  material: string | null;
  pattern: string | null;
  condition: string | null;
  googleProductCategory: string | null;
  variants: VariantInput[];
}

interface FixAttributesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: ProductFixInput[];
  onSaved?: () => void;
}

// Attribute keys that the modal manages.
type AttrKey =
  | "color"
  | "gender"
  | "ageGroup"
  | "material"
  | "pattern"
  | "condition"
  | "googleProductCategory";

const REQUIRED_PRODUCT_KEYS: AttrKey[] = [
  "color",
  "gender",
  "ageGroup",
  "material",
  "pattern",
  "condition",
  "googleProductCategory",
];

const GENDER_VALUES = ["male", "female", "unisex"] as const;
const AGE_GROUP_VALUES = [
  "newborn",
  "infant",
  "toddler",
  "kids",
  "adult",
] as const;
const CONDITION_VALUES = ["new", "refurbished", "used"] as const;

const ATTR_LABELS: Record<AttrKey, string> = {
  color: "Color",
  gender: "Gender",
  ageGroup: "Age group",
  material: "Material",
  pattern: "Pattern",
  condition: "Condition",
  googleProductCategory: "Google product category",
};

// ───────────────────────── Validation ─────────────────────────

function validateValue(key: AttrKey, value: string): string | null {
  const v = value.trim();
  if (!v) return `${ATTR_LABELS[key]} is required`;
  if (key === "gender" && !GENDER_VALUES.includes(v as typeof GENDER_VALUES[number])) {
    return "Gender must be male, female, or unisex";
  }
  if (
    key === "ageGroup" &&
    !AGE_GROUP_VALUES.includes(v as typeof AGE_GROUP_VALUES[number])
  ) {
    return "Age group must be newborn, infant, toddler, kids, or adult";
  }
  return null;
}

function isMissing(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

// ─────────────────────────── Component ───────────────────────────

export function FixAttributesModal({
  open,
  onOpenChange,
  products,
  onSaved,
}: FixAttributesModalProps) {
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkValues, setBulkValues] = useState<Record<AttrKey, string>>(
    () => emptyBulk(),
  );
  // perProduct[productId][attrKey] = value
  const [perProduct, setPerProduct] = useState<
    Record<string, Partial<Record<AttrKey, string>>>
  >({});
  // perVariant[variantId] = size
  const [perVariant, setPerVariant] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Initialise local state when products / open changes.
  useEffect(() => {
    if (!open) return;
    const seedProduct: Record<string, Partial<Record<AttrKey, string>>> = {};
    const seedVariant: Record<string, string> = {};
    for (const p of products) {
      seedProduct[p.productId] = {
        color: p.color ?? "",
        gender: p.gender ?? "",
        ageGroup: p.ageGroup ?? "",
        material: p.material ?? "",
        pattern: p.pattern ?? "",
        condition: p.condition ?? "",
        googleProductCategory: p.googleProductCategory ?? "",
      };
      for (const v of p.variants) {
        seedVariant[v.variantId] = v.size ?? "";
      }
    }
    setPerProduct(seedProduct);
    setPerVariant(seedVariant);
    setBulkValues(emptyBulk());
    setBulkMode(false);
    setErrors({});
  }, [open, products]);

  // Which product-level keys are missing across the selection?
  const missingKeysByProduct = useMemo(() => {
    const map: Record<string, AttrKey[]> = {};
    for (const p of products) {
      const missing: AttrKey[] = [];
      for (const k of REQUIRED_PRODUCT_KEYS) {
        const original = (p as unknown as Record<string, string | null>)[k];
        if (isMissing(original)) missing.push(k);
      }
      map[p.productId] = missing;
    }
    return map;
  }, [products]);

  // Union across products — what bulk fields to expose.
  const bulkAvailableKeys = useMemo(() => {
    const set = new Set<AttrKey>();
    Object.values(missingKeysByProduct).forEach((arr) =>
      arr.forEach((k) => set.add(k)),
    );
    return REQUIRED_PRODUCT_KEYS.filter((k) => set.has(k));
  }, [missingKeysByProduct]);

  const totalMissingVariantSizes = useMemo(
    () =>
      products.reduce(
        (acc, p) => acc + p.variants.filter((v) => isMissing(v.size)).length,
        0,
      ),
    [products],
  );

  // ───────── Handlers ─────────

  function setProductValue(pid: string, key: AttrKey, value: string) {
    setPerProduct((prev) => ({
      ...prev,
      [pid]: { ...prev[pid], [key]: value },
    }));
    setErrors((e) => {
      const next = { ...e };
      delete next[`${pid}:${key}`];
      return next;
    });
  }

  function setVariantSize(vid: string, value: string) {
    setPerVariant((prev) => ({ ...prev, [vid]: value }));
    setErrors((e) => {
      const next = { ...e };
      delete next[`v:${vid}`];
      return next;
    });
  }

  function applyBulkToAll() {
    const next = { ...perProduct };
    for (const pid of Object.keys(next)) {
      const missing = missingKeysByProduct[pid] ?? [];
      for (const key of missing) {
        const v = bulkValues[key];
        if (v && v.trim()) {
          next[pid] = { ...next[pid], [key]: v };
        }
      }
    }
    setPerProduct(next);
    toast.success("Bulk values applied to all products");
  }

  async function handleSubmit() {
    // Validate
    const newErrors: Record<string, string> = {};
    for (const p of products) {
      const missing = missingKeysByProduct[p.productId] ?? [];
      for (const key of missing) {
        const value = perProduct[p.productId]?.[key] ?? "";
        const err = validateValue(key, value);
        if (err) newErrors[`${p.productId}:${key}`] = err;
      }
      for (const v of p.variants) {
        if (isMissing(v.size)) {
          const value = perVariant[v.variantId] ?? "";
          if (!value.trim()) {
            newErrors[`v:${v.variantId}`] = "Size is required";
          }
        }
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      toast.error(`Please fix ${Object.keys(newErrors).length} field(s)`);
      return;
    }

    setSubmitting(true);
    let okCount = 0;
    const failures: string[] = [];

    for (const p of products) {
      try {
        const current = perProduct[p.productId] ?? {};
        const variants: VariantSize[] = p.variants.map((v) => ({
          variantId: v.variantId,
          size: (perVariant[v.variantId] ?? v.size ?? "").trim() || null,
        }));

        const attrs: GoogleFeedAttributes = {
          productId: p.productId,
          gender: nullable(current.gender ?? p.gender),
          ageGroup: nullable(current.ageGroup ?? p.ageGroup),
          color: nullable(current.color ?? p.color),
          googleProductCategory: nullable(
            current.googleProductCategory ?? p.googleProductCategory,
          ),
          customLabels: [null, null, null, null, null],
          variants,
        };

        await updateProductFeedAttributes(p.productId, attrs);
        // Sequential pacing to respect Shopify rate limits.
        await sleep(500);
        okCount += 1;
      } catch (err) {
        console.error("[FixAttributesModal] update failed", p.productId, err);
        failures.push(p.title || p.productId);
      }
    }

    setSubmitting(false);
    if (failures.length === 0) {
      toast.success(`Updated ${okCount} product${okCount === 1 ? "" : "s"}`);
      onSaved?.();
      onOpenChange(false);
    } else {
      toast.error(
        `Updated ${okCount}, failed ${failures.length}: ${failures
          .slice(0, 3)
          .join(", ")}${failures.length > 3 ? "…" : ""}`,
      );
    }
  }

  // ───────── Render ─────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fix Google Shopping attributes</DialogTitle>
          <DialogDescription>
            {products.length === 1
              ? `Complete the missing attributes for "${products[0]?.title}".`
              : `Complete missing attributes for ${products.length} products${
                  totalMissingVariantSizes > 0
                    ? ` and ${totalMissingVariantSizes} variant size${totalMissingVariantSizes === 1 ? "" : "s"}`
                    : ""
                }.`}
          </DialogDescription>
        </DialogHeader>

        {products.length > 1 && bulkAvailableKeys.length > 0 && (
          <div className="rounded-md border bg-muted/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                <Label htmlFor="bulk-mode" className="font-medium">
                  Bulk apply
                </Label>
              </div>
              <Switch
                id="bulk-mode"
                checked={bulkMode}
                onCheckedChange={setBulkMode}
              />
            </div>
            {bulkMode && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {bulkAvailableKeys.map((key) => (
                    <AttributeField
                      key={key}
                      attrKey={key}
                      value={bulkValues[key]}
                      onChange={(v) =>
                        setBulkValues((prev) => ({ ...prev, [key]: v }))
                      }
                    />
                  ))}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={applyBulkToAll}
                >
                  Apply to all products
                </Button>
              </>
            )}
          </div>
        )}

        <ScrollArea className="max-h-[55vh] pr-3">
          <div className="space-y-5">
            {products.map((p) => {
              const missing = missingKeysByProduct[p.productId] ?? [];
              const missingVariants = p.variants.filter((v) =>
                isMissing(v.size),
              );
              if (missing.length === 0 && missingVariants.length === 0) {
                return (
                  <div
                    key={p.productId}
                    className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
                  >
                    <span className="font-medium text-foreground">
                      {p.title}
                    </span>{" "}
                    — no missing attributes.
                  </div>
                );
              }
              return (
                <div key={p.productId} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="font-medium">{p.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {missing.length} attribute
                        {missing.length === 1 ? "" : "s"} missing
                        {missingVariants.length > 0 &&
                          `, ${missingVariants.length} variant size${missingVariants.length === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <Badge variant="outline">{p.productId.split("/").pop()}</Badge>
                  </div>

                  {missing.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {missing.map((key) => (
                        <AttributeField
                          key={key}
                          attrKey={key}
                          value={perProduct[p.productId]?.[key] ?? ""}
                          onChange={(v) => setProductValue(p.productId, key, v)}
                          error={errors[`${p.productId}:${key}`]}
                        />
                      ))}
                    </div>
                  )}

                  {missingVariants.length > 0 && (
                    <>
                      <Separator className="my-3" />
                      <div className="text-sm font-medium mb-2">
                        Variant sizes
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {missingVariants.map((v) => (
                          <div key={v.variantId} className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                              {v.title || v.variantId.split("/").pop()}
                            </Label>
                            <Input
                              value={perVariant[v.variantId] ?? ""}
                              onChange={(e) =>
                                setVariantSize(v.variantId, e.target.value)
                              }
                              placeholder="e.g. M, 32, 8.5"
                              aria-invalid={
                                !!errors[`v:${v.variantId}`] || undefined
                              }
                            />
                            {errors[`v:${v.variantId}`] && (
                              <p className="text-xs text-destructive">
                                {errors[`v:${v.variantId}`]}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save attributes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────── Small subcomponents ───────────────────────

interface AttributeFieldProps {
  attrKey: AttrKey;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

function AttributeField({ attrKey, value, onChange, error }: AttributeFieldProps) {
  const label = ATTR_LABELS[attrKey];

  let control: React.ReactNode;
  if (attrKey === "gender") {
    control = (
      <EnumSelect
        value={value}
        onChange={onChange}
        options={GENDER_VALUES as readonly string[]}
        placeholder="Select gender"
      />
    );
  } else if (attrKey === "ageGroup") {
    control = (
      <EnumSelect
        value={value}
        onChange={onChange}
        options={AGE_GROUP_VALUES as readonly string[]}
        placeholder="Select age group"
      />
    );
  } else if (attrKey === "condition") {
    control = (
      <EnumSelect
        value={value}
        onChange={onChange}
        options={CONDITION_VALUES as readonly string[]}
        placeholder="Select condition"
      />
    );
  } else {
    control = (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          attrKey === "googleProductCategory"
            ? "e.g. Apparel & Accessories > Clothing"
            : `Enter ${label.toLowerCase()}`
        }
        aria-invalid={!!error || undefined}
      />
    );
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {control}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function EnumSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder: string;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─────────────────────────── Utils ───────────────────────────

function emptyBulk(): Record<AttrKey, string> {
  return {
    color: "",
    gender: "",
    ageGroup: "",
    material: "",
    pattern: "",
    condition: "",
    googleProductCategory: "",
  };
}

function nullable(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t ? t : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default FixAttributesModal;
