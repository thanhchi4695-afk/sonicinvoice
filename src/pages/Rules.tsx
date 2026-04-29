import { RuleListPage } from "@/components/guardian/RuleListPage";
import { ExtensionTokensPanel } from "@/components/guardian/ExtensionTokensPanel";

const Rules = () => (
  <div className="space-y-8">
    <RuleListPage />
    <ExtensionTokensPanel />
  </div>
);

export default Rules;
