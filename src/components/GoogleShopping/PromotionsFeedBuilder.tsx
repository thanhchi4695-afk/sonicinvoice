/**
 * PromotionsFeedBuilder
 *
 * Builds a Google Shopping promotion (Merchant Center promotions feed),
 * tests the promotion against sample products, previews how it would
 * render on a product card, and either downloads the XML/TXT feed file
 * or publishes it to Merchant Center via the `gmc-promotions` edge fn.
 *
 * Promotion price math always applies BEFORE shipping & tax — the
 * preview enforces the same order so what you see matches what GMC shows.
 */

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  CalendarIcon,
  Download,
  FlaskConical,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { addAuditEntry } from "@/lib/audit-log";

// ───────────────────────── Types ─────────────────────────

type ProductApplicability = "ALL_PRODUCTS" | "SPECIFIC_PRODUCTS";
type RedemptionChannel = "ONLINE" | "IN_STORE";
type OfferType =
  | "PERCENT_OFF"
  | "MONEY_OFF"
  | "FREE_GIFT"
  | "FREE_SHIPPING_STANDARD"
  | "BUY_M_GET_N_MONEY_OFF";

export interface PromotionDraft {
  promotion_id: string;
  long_title: string;
  product_applicability: ProductApplicability;
  offer_type: OfferType;
  percentage_discount?: number;
  money_off_amount?: number;
  money_off_currency: string;
  minimum_purchase_amount?: number;
  start_date: Date;
  end_date: Date;
  redemption_channel: RedemptionChannel[];
  item_ids: string[];
  buy_quantity?: number;
  get_quantity?: number;
  free_gift_description?: string;
}

interface SampleProduct {
  id: string;
  title: string;
  price: number;
  shipping?: number;
  taxRate?: number;
}

const OFFER_TYPE_LABEL: Record<OfferType, string> = {
  PERCENT_OFF: "Percentage off",
  MONEY_OFF: "Fixed amount off",
  FREE_GIFT: "Free gift",
  FREE_SHIPPING_STANDARD: "Free shipping",
  BUY_M_GET_N_MONEY_OFF: "Buy X get Y",
};

const CURRENCIES = ["USD", "AUD", "EUR", "GBP", "CAD", "NZD"] as const;
const COUNTRY_OPTIONS = ["US", "AU", "GB", "CA", "NZ", "DE", "FR"] as const;

const DEFAULT_SAMPLES: SampleProduct[] = [
  { id: "sku-001", title: "Linen Maxi Dress", price: 189, shipping: 12, taxRate: 0.1 },
  { id: "sku-002", title: "Cotton Tee", price: 45, shipping: 8, taxRate: 0.1 },
  { id: "sku-003", title: "Leather Tote", price: 320, shipping: 15, taxRate: 0.1 },
];

// ───────────────────────── Helpers ─────────────────────────

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) ||
  `promo-${Date.now()}`;

function emptyDraft(): PromotionDraft {
  const start = new Date();
  const end = new Date();
  end.setDate(end.getDate() + 7);
  return {
    promotion_id: `promo-${Date.now().toString(36)}`,
    long_title: "",
    product_applicability: "ALL_PRODUCTS",
    offer_type: "PERCENT_OFF",
    percentage_discount: 20,
    money_off_amount: undefined,
    money_off_currency: "USD",
    minimum_purchase_amount: undefined,
    start_date: start,
    end_date: end,
    redemption_channel: ["ONLINE"],
    item_ids: [],
  };
}

/** Apply promotion to a sample product. Always BEFORE shipping/tax. */
function applyPromotion(
  product: SampleProduct,
  promo: PromotionDraft,
): {
  appliedDiscount: number;
  newPrice: number;
  shipping: number;
  tax: number;
  total: number;
  eligible: boolean;
  reason?: string;
} {
  const shipping = product.shipping ?? 0;
  const taxRate = product.taxRate ?? 0;
  const noChange = (reason?: string) => ({
    appliedDiscount: 0,
    newPrice: product.price,
    shipping,
    tax: +(product.price * taxRate).toFixed(2),
    total: +(product.price + shipping + product.price * taxRate).toFixed(2),
    eligible: false,
    reason,
  });

  if (
    promo.product_applicability === "SPECIFIC_PRODUCTS" &&
    !promo.item_ids.includes(product.id)
  ) {
    return noChange("Not in item_ids list");
  }
  if (promo.minimum_purchase_amount && product.price < promo.minimum_purchase_amount) {
    return noChange(`Below minimum purchase $${promo.minimum_purchase_amount}`);
  }

  let discounted = product.price;
  let appliedDiscount = 0;
  let extraShipping = shipping;

  switch (promo.offer_type) {
    case "PERCENT_OFF":
      appliedDiscount = +(product.price * ((promo.percentage_discount ?? 0) / 100)).toFixed(2);
      discounted = +(product.price - appliedDiscount).toFixed(2);
      break;
    case "MONEY_OFF":
      appliedDiscount = Math.min(promo.money_off_amount ?? 0, product.price);
      discounted = +(product.price - appliedDiscount).toFixed(2);
      break;
    case "FREE_SHIPPING_STANDARD":
      extraShipping = 0;
      break;
    case "BUY_M_GET_N_MONEY_OFF": {
      const buy = promo.buy_quantity ?? 1;
      const get = promo.get_quantity ?? 1;
      const off = promo.money_off_amount ?? 0;
      // Effective per-unit discount across buy+get bundle.
      appliedDiscount = +(off / (buy + get)).toFixed(2);
      discounted = +(product.price - appliedDiscount).toFixed(2);
      break;
    }
    case "FREE_GIFT":
      // No price change — free gift handled at checkout.
      break;
  }

  const tax = +(discounted * taxRate).toFixed(2);
  return {
    appliedDiscount,
    newPrice: discounted,
    shipping: extraShipping,
    tax,
    total: +(discounted + extraShipping + tax).toFixed(2),
    eligible: true,
  };
}

/** Build XML feed for one promotion (matches the edge function). */
function buildXmlFeed(promo: PromotionDraft, country: string, lang: string): string {
  const xmlEscape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const dates = `${promo.start_date.toISOString()}/${promo.end_date.toISOString()}`;
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`);
  lines.push(`  <channel>`);
  lines.push(`    <title>Promotions Feed</title>`);
  lines.push(`    <promotion>`);
  lines.push(`      <promotion_id>${xmlEscape(promo.promotion_id)}</promotion_id>`);
  lines.push(`      <product_applicability>${promo.product_applicability}</product_applicability>`);
  lines.push(`      <offer_type>${promo.offer_type}</offer_type>`);
  lines.push(`      <long_title>${xmlEscape(promo.long_title)}</long_title>`);
  lines.push(`      <promotion_effective_dates>${dates}</promotion_effective_dates>`);
  lines.push(`      <target_country>${country}</target_country>`);
  lines.push(`      <content_language>${lang}</content_language>`);
  for (const ch of promo.redemption_channel)
    lines.push(`      <redemption_channel>${ch}</redemption_channel>`);
  if (promo.percentage_discount != null)
    lines.push(`      <percent_off>${promo.percentage_discount}</percent_off>`);
  if (promo.money_off_amount)
    lines.push(`      <money_off_amount>${promo.money_off_amount.toFixed(2)} ${promo.money_off_currency}</money_off_amount>`);
  if (promo.minimum_purchase_amount)
    lines.push(`      <minimum_purchase_amount>${promo.minimum_purchase_amount.toFixed(2)} ${promo.money_off_currency}</minimum_purchase_amount>`);
  if (promo.buy_quantity)
    lines.push(`      <minimum_purchase_quantity>${promo.buy_quantity}</minimum_purchase_quantity>`);
  if (promo.get_quantity)
    lines.push(`      <get_this_quantity_discounted>${promo.get_quantity}</get_this_quantity_discounted>`);
  if (promo.free_gift_description)
    lines.push(`      <free_gift_description>${xmlEscape(promo.free_gift_description)}</free_gift_description>`);
  for (const id of promo.item_ids)
    lines.push(`      <item_id>${xmlEscape(id)}</item_id>`);
  lines.push(`    </promotion>`);
  lines.push(`  </channel>`);
  lines.push(`</rss>`);
  return lines.join("\n");
}

/** Tab-delimited TXT feed (Merchant Center alternative). */
function buildTxtFeed(promo: PromotionDraft, country: string, lang: string): string {
  const cols = [
    "promotion_id",
    "product_applicability",
    "offer_type",
    "long_title",
    "promotion_effective_dates",
    "target_country",
    "content_language",
    "redemption_channel",
    "percent_off",
    "money_off_amount",
    "minimum_purchase_amount",
    "minimum_purchase_quantity",
    "get_this_quantity_discounted",
    "free_gift_description",
    "item_id",
  ];
  const dates = `${promo.start_date.toISOString()}/${promo.end_date.toISOString()}`;
  const row = [
    promo.promotion_id,
    promo.product_applicability,
    promo.offer_type,
    promo.long_title,
    dates,
    country,
    lang,
    promo.redemption_channel.join(","),
    promo.percentage_discount ?? "",
    promo.money_off_amount ? `${promo.money_off_amount.toFixed(2)} ${promo.money_off_currency}` : "",
    promo.minimum_purchase_amount ? `${promo.minimum_purchase_amount.toFixed(2)} ${promo.money_off_currency}` : "",
    promo.buy_quantity ?? "",
    promo.get_quantity ?? "",
    promo.free_gift_description ?? "",
    promo.item_ids.join(","),
  ];
  return `${cols.join("\t")}\n${row.join("\t")}`;
}

function downloadFile(name: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ───────────────────────── Component ─────────────────────────

interface Props {
  /** Optional merchant-supplied sample products for testing. */
  sampleProducts?: SampleProduct[];
}

export default function PromotionsFeedBuilder({ sampleProducts }: Props) {
  const [draft, setDraft] = useState<PromotionDraft>(emptyDraft);
  const [country, setCountry] = useState<string>("US");
  const [language, setLanguage] = useState<string>("en");
  const [itemIdInput, setItemIdInput] = useState("");
  const [publishing, setPublishing] = useState(false);
  const samples = sampleProducts ?? DEFAULT_SAMPLES;

  const update = <K extends keyof PromotionDraft>(key: K, value: PromotionDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const offerTypeChange = (next: OfferType) => {
    setDraft((d) => ({
      ...d,
      offer_type: next,
      percentage_discount: next === "PERCENT_OFF" ? d.percentage_discount ?? 20 : undefined,
      money_off_amount:
        next === "MONEY_OFF" || next === "BUY_M_GET_N_MONEY_OFF"
          ? d.money_off_amount ?? 10
          : undefined,
      buy_quantity: next === "BUY_M_GET_N_MONEY_OFF" ? d.buy_quantity ?? 2 : undefined,
      get_quantity: next === "BUY_M_GET_N_MONEY_OFF" ? d.get_quantity ?? 1 : undefined,
      free_gift_description: next === "FREE_GIFT" ? d.free_gift_description ?? "" : undefined,
    }));
  };

  const toggleChannel = (channel: RedemptionChannel) => {
    setDraft((d) => {
      const has = d.redemption_channel.includes(channel);
      return {
        ...d,
        redemption_channel: has
          ? d.redemption_channel.filter((c) => c !== channel)
          : [...d.redemption_channel, channel],
      };
    });
  };

  const addItemId = () => {
    const v = itemIdInput.trim();
    if (!v) return;
    if (draft.item_ids.includes(v)) {
      setItemIdInput("");
      return;
    }
    update("item_ids", [...draft.item_ids, v]);
    setItemIdInput("");
  };

  const removeItemId = (id: string) =>
    update("item_ids", draft.item_ids.filter((x) => x !== id));

  // ── Live previews ──
  const previews = useMemo(
    () => samples.map((s) => ({ product: s, result: applyPromotion(s, draft) })),
    [samples, draft],
  );

  const xml = useMemo(() => buildXmlFeed(draft, country, language), [draft, country, language]);
  const txt = useMemo(() => buildTxtFeed(draft, country, language), [draft, country, language]);

  // ── Validation summary ──
  const validationIssues = useMemo(() => {
    const issues: string[] = [];
    if (!draft.promotion_id || !/^[A-Za-z0-9_\-]{1,50}$/.test(draft.promotion_id))
      issues.push("promotion_id must be 1–50 chars [A-Z, a-z, 0-9, _, -]");
    if (!draft.long_title.trim()) issues.push("long_title required");
    if (draft.long_title.length > 150) issues.push("long_title max 150 chars");
    if (draft.end_date <= draft.start_date) issues.push("end_date must be after start_date");
    if (draft.redemption_channel.length === 0) issues.push("Pick at least one redemption channel");
    if (draft.product_applicability === "SPECIFIC_PRODUCTS" && draft.item_ids.length === 0)
      issues.push("Add at least one item_id for specific-product promotions");
    if (draft.offer_type === "PERCENT_OFF" &&
       (!draft.percentage_discount || draft.percentage_discount < 1 || draft.percentage_discount > 99))
      issues.push("percentage_discount must be 1–99");
    if (draft.offer_type === "MONEY_OFF" && (!draft.money_off_amount || draft.money_off_amount <= 0))
      issues.push("money_off_amount must be > 0");
    if (draft.offer_type === "BUY_M_GET_N_MONEY_OFF") {
      if (!draft.buy_quantity || !draft.get_quantity || !draft.money_off_amount)
        issues.push("Buy X Get Y needs buy_quantity, get_quantity, money_off_amount");
      if (draft.item_ids.length === 0)
        issues.push("Buy X Get Y needs at least one linked item_id");
    }
    if (draft.offer_type === "FREE_GIFT" && !draft.free_gift_description?.trim())
      issues.push("free_gift_description required for free gift promotions");
    return issues;
  }, [draft]);

  const isValid = validationIssues.length === 0;

  // ── Actions ──
  const handleDownloadXml = () => {
    if (!isValid) {
      toast.error("Fix validation issues first");
      return;
    }
    downloadFile(`${slugify(draft.promotion_id)}.xml`, "application/xml", xml);
    addAuditEntry("promotion_feed_download", JSON.stringify({ id: draft.promotion_id, format: "xml" }));
  };

  const handleDownloadTxt = () => {
    if (!isValid) {
      toast.error("Fix validation issues first");
      return;
    }
    downloadFile(`${slugify(draft.promotion_id)}.txt`, "text/tab-separated-values", txt);
    addAuditEntry("promotion_feed_download", JSON.stringify({ id: draft.promotion_id, format: "txt" }));
  };

  const buildPayload = () => ({
    country,
    languageCode: language,
    promotion: {
      promotion_id: draft.promotion_id,
      long_title: draft.long_title,
      product_applicability: draft.product_applicability,
      offer_type: draft.offer_type,
      percentage_discount: draft.percentage_discount,
      money_off_amount: draft.money_off_amount,
      money_off_currency: draft.money_off_currency,
      minimum_purchase_amount: draft.minimum_purchase_amount,
      minimum_purchase_currency: draft.money_off_currency,
      promotion_effective_dates: {
        start: draft.start_date.toISOString(),
        end: draft.end_date.toISOString(),
      },
      redemption_channel: draft.redemption_channel,
      item_ids: draft.item_ids,
      buy_quantity: draft.buy_quantity,
      get_quantity: draft.get_quantity,
      free_gift_description: draft.free_gift_description,
    },
  });

  const handleTestDryRun = async () => {
    if (!isValid) {
      toast.error("Fix validation issues first");
      return;
    }
    setPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmc-promotions", {
        body: { ...buildPayload(), dryRun: true },
      });
      if (error) throw new Error(error.message);
      if (data?.ok) toast.success("Dry-run passed — promotion is well-formed");
      else toast.error(data?.error || "Dry-run failed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Dry-run failed");
    } finally {
      setPublishing(false);
    }
  };

  const handlePublish = async () => {
    if (!isValid) {
      toast.error("Fix validation issues first");
      return;
    }
    setPublishing(true);
    try {
      const { data, error } = await supabase.functions.invoke("gmc-promotions", {
        body: buildPayload(),
      });
      if (error) throw new Error(error.message);
      if (data?.ok) {
        toast.success(`Published ${data.promotionId} to Merchant Center`);
        addAuditEntry(
          "promotion_published",
          JSON.stringify({ id: draft.promotion_id, offer: draft.offer_type, country }),
        );
      } else {
        toast.error(data?.error || "Merchant Center rejected the promotion");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  };

  // ─────────────── Render ───────────────

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Tag className="h-5 w-5 text-amber-400" />
            Promotions Feed Builder
          </h2>
          <p className="text-sm text-muted-foreground">
            Compose Google Shopping promotion badges, validate against sample products, then publish to Merchant Center.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setDraft(emptyDraft())}>
            Reset
          </Button>
          <Button variant="outline" onClick={handleTestDryRun} disabled={publishing || !isValid}>
            {publishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FlaskConical className="h-4 w-4 mr-1" />}
            Validate
          </Button>
          <Button variant="outline" onClick={handleDownloadXml} disabled={!isValid}>
            <Download className="h-4 w-4 mr-1" /> XML
          </Button>
          <Button variant="outline" onClick={handleDownloadTxt} disabled={!isValid}>
            <Download className="h-4 w-4 mr-1" /> TXT
          </Button>
          <Button onClick={handlePublish} disabled={publishing || !isValid}>
            {publishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
            Publish to GMC
          </Button>
        </div>
      </div>

      {validationIssues.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4 space-y-1">
              {validationIssues.map((i) => <li key={i}>{i}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Left column: configuration ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">Promotion configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Promotion ID</Label>
                <Input
                  value={draft.promotion_id}
                  onChange={(e) => update("promotion_id", e.target.value)}
                  placeholder="spring-sale-2026"
                />
                <p className="text-[11px] text-muted-foreground">Globally unique per feed.</p>
              </div>
              <div className="space-y-1">
                <Label>Currency</Label>
                <Select
                  value={draft.money_off_currency}
                  onValueChange={(v) => update("money_off_currency", v)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Long title (shown in ad)</Label>
              <Input
                value={draft.long_title}
                maxLength={150}
                onChange={(e) => update("long_title", e.target.value)}
                placeholder="20% off all swimwear"
              />
              <p className="text-[11px] text-muted-foreground">
                {draft.long_title.length}/150 characters
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Applies to</Label>
                <Select
                  value={draft.product_applicability}
                  onValueChange={(v) => update("product_applicability", v as ProductApplicability)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL_PRODUCTS">All products</SelectItem>
                    <SelectItem value="SPECIFIC_PRODUCTS">Specific products</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Offer type</Label>
                <Select value={draft.offer_type} onValueChange={(v) => offerTypeChange(v as OfferType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(OFFER_TYPE_LABEL) as OfferType[]).map((k) => (
                      <SelectItem key={k} value={k}>{OFFER_TYPE_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Offer-type-specific inputs */}
            {draft.offer_type === "PERCENT_OFF" && (
              <div className="space-y-1">
                <Label>Percentage discount (1–99)</Label>
                <Input
                  type="number" min={1} max={99}
                  value={draft.percentage_discount ?? ""}
                  onChange={(e) => update("percentage_discount", e.target.value ? +e.target.value : undefined)}
                />
              </div>
            )}
            {draft.offer_type === "MONEY_OFF" && (
              <div className="space-y-1">
                <Label>Money off amount</Label>
                <Input
                  type="number" min={0.01} step={0.01}
                  value={draft.money_off_amount ?? ""}
                  onChange={(e) => update("money_off_amount", e.target.value ? +e.target.value : undefined)}
                />
              </div>
            )}
            {draft.offer_type === "FREE_GIFT" && (
              <div className="space-y-1">
                <Label>Free gift description</Label>
                <Input
                  value={draft.free_gift_description ?? ""}
                  onChange={(e) => update("free_gift_description", e.target.value)}
                  placeholder="Free travel tote with every $100+ order"
                />
              </div>
            )}
            {draft.offer_type === "BUY_M_GET_N_MONEY_OFF" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Buy quantity</Label>
                  <Input type="number" min={1}
                    value={draft.buy_quantity ?? ""}
                    onChange={(e) => update("buy_quantity", e.target.value ? +e.target.value : undefined)} />
                </div>
                <div className="space-y-1">
                  <Label>Get quantity</Label>
                  <Input type="number" min={1}
                    value={draft.get_quantity ?? ""}
                    onChange={(e) => update("get_quantity", e.target.value ? +e.target.value : undefined)} />
                </div>
                <div className="space-y-1">
                  <Label>Money off</Label>
                  <Input type="number" min={0.01} step={0.01}
                    value={draft.money_off_amount ?? ""}
                    onChange={(e) => update("money_off_amount", e.target.value ? +e.target.value : undefined)} />
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label>Minimum purchase amount (optional)</Label>
              <Input
                type="number" min={0} step={0.01}
                value={draft.minimum_purchase_amount ?? ""}
                onChange={(e) => update("minimum_purchase_amount", e.target.value ? +e.target.value : undefined)}
              />
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start date (UTC)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn(
                      "w-full justify-start text-left font-normal",
                      !draft.start_date && "text-muted-foreground",
                    )}>
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {format(draft.start_date, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={draft.start_date}
                      onSelect={(d) => d && update("start_date", d)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1">
                <Label>End date (UTC)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn(
                      "w-full justify-start text-left font-normal",
                      !draft.end_date && "text-muted-foreground",
                    )}>
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {format(draft.end_date, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={draft.end_date}
                      onSelect={(d) => d && update("end_date", d)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Redemption channel</Label>
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <Switch
                    checked={draft.redemption_channel.includes("ONLINE")}
                    onCheckedChange={() => toggleChannel("ONLINE")}
                  />
                  Online
                </label>
                <label className="flex items-center gap-2">
                  <Switch
                    checked={draft.redemption_channel.includes("IN_STORE")}
                    onCheckedChange={() => toggleChannel("IN_STORE")}
                  />
                  In store
                </label>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Target country</Label>
                <Select value={country} onValueChange={setCountry}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COUNTRY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Content language</Label>
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={5} />
              </div>
            </div>

            {(draft.product_applicability === "SPECIFIC_PRODUCTS" ||
              draft.offer_type === "BUY_M_GET_N_MONEY_OFF") && (
              <div className="space-y-2">
                <Label>Linked item IDs</Label>
                <div className="flex gap-2">
                  <Input
                    value={itemIdInput}
                    onChange={(e) => setItemIdInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItemId(); } }}
                    placeholder="sku-001"
                  />
                  <Button variant="secondary" onClick={addItemId}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {draft.item_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {draft.item_ids.map((id) => (
                      <Badge key={id} variant="secondary" className="gap-1">
                        {id}
                        <button onClick={() => removeItemId(id)} className="hover:opacity-70">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Right column: preview & feed output ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-amber-400" />
              Preview & feed output
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="cards">
              <TabsList className="w-full">
                <TabsTrigger value="cards" className="flex-1">Sample products</TabsTrigger>
                <TabsTrigger value="xml" className="flex-1">XML feed</TabsTrigger>
                <TabsTrigger value="txt" className="flex-1">TXT feed</TabsTrigger>
              </TabsList>

              <TabsContent value="cards" className="space-y-3 pt-3">
                <p className="text-xs text-muted-foreground">
                  Discounts apply <strong>before</strong> shipping &amp; tax — same order Google uses.
                </p>
                {previews.map(({ product, result }) => (
                  <div key={product.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{product.title}</div>
                        <div className="text-xs text-muted-foreground font-mono">{product.id}</div>
                      </div>
                      {result.eligible ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 border">
                          {draft.long_title || "Promo applied"}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Not eligible
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Was</div>
                        <div className={cn("font-mono tabular-nums", result.eligible && "line-through text-muted-foreground")}>
                          ${product.price.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Now</div>
                        <div className="font-mono tabular-nums font-semibold text-amber-300">
                          ${result.newPrice.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">+ Ship</div>
                        <div className="font-mono tabular-nums">${result.shipping.toFixed(2)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">+ Tax</div>
                        <div className="font-mono tabular-nums">${result.tax.toFixed(2)}</div>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Total: <span className="font-mono">${result.total.toFixed(2)}</span>
                      {result.reason && <> · {result.reason}</>}
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="xml" className="pt-3">
                <Textarea readOnly value={xml} className="font-mono text-xs min-h-[420px]" />
              </TabsContent>
              <TabsContent value="txt" className="pt-3">
                <Textarea readOnly value={txt} className="font-mono text-xs min-h-[420px]" />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Alert>
        <Upload className="h-4 w-4" />
        <AlertDescription>
          Publishing calls Google's Content API <code>promotions.insert</code> with your
          configured Merchant Center credentials. Use <strong>Validate</strong> first to dry-run without
          sending data to Google.
        </AlertDescription>
      </Alert>
    </div>
  );
}
