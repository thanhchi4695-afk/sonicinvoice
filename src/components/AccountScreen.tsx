import { useState } from "react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const AccountScreen = () => {
  const [storeName, setStoreName] = useState("");
  const [currency, setCurrency] = useState("AUD");
  const [markup, setMarkup] = useState("2.35");
  const [rounding, setRounding] = useState("nearest_05");

  return (
    <div className="px-4 pt-6 pb-24 animate-fade-in">
      <h1 className="text-2xl font-bold font-display mb-1">Account</h1>
      <p className="text-muted-foreground text-sm mb-6">Store settings & pricing rules</p>

      {/* Store Details */}
      <Section title="Store details">
        <Field label="Store name" value={storeName} onChange={setStoreName} placeholder="My Boutique" />
        <Field label="Store website" placeholder="myboutique.com.au" />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Currency" value={currency} onChange={setCurrency}
            options={[{ v: "AUD", l: "AUD" }, { v: "USD", l: "USD" }, { v: "GBP", l: "GBP" }, { v: "NZD", l: "NZD" }, { v: "EUR", l: "EUR" }]}
          />
          <SelectField label="Locale" value="AU" onChange={() => {}}
            options={[{ v: "AU", l: "Australia" }, { v: "US", l: "US" }, { v: "UK", l: "UK" }, { v: "NZ", l: "NZ" }]}
          />
        </div>
      </Section>

      {/* Pricing Rules */}
      <Section title="Pricing rules">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Default markup</label>
            <input value={markup} onChange={(e) => setMarkup(e.target.value)} className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm font-mono-data" />
          </div>
          <SelectField label="Rounding" value={rounding} onChange={setRounding}
            options={[{ v: "nearest_05", l: "$0.05" }, { v: "nearest_1", l: "$1.00" }, { v: "charm_95", l: ".95" }]}
          />
        </div>
      </Section>

      {/* Shopify */}
      <Section title="Shopify connection">
        <Field label="Store URL" placeholder="yourstore.myshopify.com" />
        <Field label="Access token" placeholder="shpat_xxxxx" type="password" />
        <Button variant="outline" className="w-full h-10">Test connection</Button>
      </Section>

      <Button variant="teal" className="w-full mt-4 h-12 text-base">Save settings</Button>

      <Button variant="ghost" className="w-full mt-6 text-destructive h-12">
        <LogOut className="w-4 h-4 mr-2" /> Sign out
      </Button>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="mb-6">
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">{title}</h3>
    <div className="space-y-3">{children}</div>
  </div>
);

const Field = ({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value?: string; onChange?: (v: string) => void; placeholder?: string; type?: string;
}) => (
  <div>
    <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
    <input type={type} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined} placeholder={placeholder}
      className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm" />
  </div>
);

const SelectField = ({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) => (
  <div>
    <label className="text-xs text-muted-foreground mb-1 block">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full h-10 rounded-md bg-input border border-border px-3 text-sm text-foreground">
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </div>
);

export default AccountScreen;
