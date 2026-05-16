import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ShopifyEmbeddedProvider from "@/components/ShopifyEmbeddedProvider";
import EmbeddedAuthHealthCheck from "@/components/EmbeddedAuthHealthCheck";
import RequireAuth from "@/components/RequireAuth";
import InstallAppBanner from "@/components/InstallAppBanner";
import StockyAnnouncementBar from "@/components/StockyAnnouncementBar";
import BarcodeProvider from "@/components/BarcodeProvider";
import AskSonicAI from "@/components/AskSonicAI";
import ClaudePopupButton from "@/components/ClaudePopupButton";
import { ConfirmDialogProvider } from "@/hooks/use-confirm-dialog";
import { PromptDialogProvider } from "@/hooks/use-prompt-dialog";
import { AgentNotificationsProvider } from "@/hooks/use-agent-notifications";
import Index from "./pages/Index.tsx";
import Landing from "./pages/Landing.tsx";
import Home from "./pages/Home.tsx";
import Demo from "./pages/Demo.tsx";
import Login from "./pages/Login.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import AuthCallbackPage from "./pages/AuthCallback.tsx";
import NotFound from "./pages/NotFound.tsx";
import Support from "./pages/Support.tsx";
import Unsubscribe from "./pages/Unsubscribe.tsx";
import Privacy from "./pages/Privacy.tsx";
import BrandGuide from "./pages/BrandGuide.tsx";
import HowItWorks from "./pages/HowItWorks.tsx";
import Workflows from "./pages/Workflows.tsx";
import { CaseStudyPage } from "./pages/CaseStudy.tsx";
import Health from "./pages/Health.tsx";
import AdminSecrets from "./pages/AdminSecrets.tsx";
import AdminAIModels from "./pages/AdminAIModels.tsx";
import AdminTrainingPipeline from "./pages/AdminTrainingPipeline.tsx";
import Rules from "./pages/Rules.tsx";
import RulesSetup from "./pages/RulesSetup.tsx";
import SonicKnowledge from "./pages/SonicKnowledge.tsx";
import DriveWatcher from "./pages/DriveWatcher.tsx";
import ClaudeConnector from "./pages/ClaudeConnector.tsx";
import ClaudeActivity from "./pages/ClaudeActivity.tsx";
import { lazy, Suspense } from "react";
const GoogleShoppingHub = lazy(() => import("./components/GoogleShopping/GoogleShoppingHub.tsx"));
const PricingIntelligence = lazy(() => import("./pages/PricingIntelligence.tsx"));
const FeedHealthPanel = lazy(() => import("./components/FeedHealthPanel.tsx"));
const Collections = lazy(() => import("./pages/Collections.tsx"));
const SonicRank = lazy(() => import("./pages/SonicRank.tsx"));
const Brands = lazy(() => import("./pages/Brands.tsx"));
const SeoEngine = lazy(() => import("./pages/SeoEngine.tsx"));
const SeoKeywords = lazy(() => import("./pages/SeoKeywords.tsx"));
const SeoBlogPlans = lazy(() => import("./pages/SeoBlogPlans.tsx"));
const SeoLinkMesh = lazy(() => import("./pages/SeoLinkMesh.tsx"));
const AutoIngest = lazy(() => import("./pages/AutoIngest.tsx"));
const FunctionsCatalog = lazy(() => import("./pages/FunctionsCatalog.tsx"));
const Agent = lazy(() => import("./pages/Agent.tsx"));
const Approvals = lazy(() => import("./pages/Approvals.tsx"));
const AuditLog = lazy(() => import("./pages/AuditLog.tsx"));
const MobileApprovals = lazy(() => import("./pages/MobileApprovals.tsx"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ShopifyEmbeddedProvider>
        <BarcodeProvider>
          <ConfirmDialogProvider>
            <PromptDialogProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <AgentNotificationsProvider>
                <StockyAnnouncementBar />
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/demo" element={<Demo />} />
                  <Route path="/landing-old" element={<Landing />} />
                  <Route path="/dashboard" element={<Index />} />
                  <Route path="/dashboard/*" element={<Index />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/login/signup" element={<Login />} />
                  <Route path="/sign-in" element={<Navigate to="/login" replace />} />
                  <Route path="/signin" element={<Navigate to="/login" replace />} />
                  <Route path="/signup" element={<Navigate to="/login?signup=1" replace />} />
                  <Route path="/sign-up" element={<Navigate to="/login?signup=1" replace />} />
                  <Route path="/register" element={<Navigate to="/login?signup=1" replace />} />
                  <Route path="/auth" element={<Navigate to="/login" replace />} />
                  <Route path="/settings" element={<Index initialTab="account" />} />
                  <Route path="/account" element={<Index initialTab="account" />} />
                  <Route path="/billing" element={<Index initialTab="billing" />} />
                  <Route path="/reset-password" element={<ResetPassword />} />
                  <Route path="/auth/xero/callback" element={<AuthCallbackPage />} />
                  <Route path="/auth/myob/callback" element={<AuthCallbackPage />} />
                  <Route path="/auth/lightspeed-x/callback" element={<AuthCallbackPage />} />
                  <Route path="/auth/lightspeed-r/callback" element={<AuthCallbackPage />} />
                  <Route path="/support" element={<Support />} />
                  <Route path="/unsubscribe" element={<Unsubscribe />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/brand-guide" element={<BrandGuide />} />
                  <Route path="/how-it-works" element={<HowItWorks />} />
                  <Route path="/case-study" element={<CaseStudyPage />} />
                  <Route path="/health" element={<Health />} />
                  <Route path="/admin/secrets" element={<AdminSecrets />} />
                  <Route path="/admin/ai-models" element={<AdminAIModels />} />
                  <Route path="/admin/training-pipeline" element={<RequireAuth><AdminTrainingPipeline /></RequireAuth>} />
                  <Route path="/rules" element={<Rules />} />
                  <Route path="/rules/setup" element={<RulesSetup />} />
                  <Route path="/collections" element={<Suspense fallback={null}><Collections /></Suspense>} />
                  <Route path="/rank" element={<Suspense fallback={null}><SonicRank /></Suspense>} />
                  <Route path="/brands" element={<Suspense fallback={null}><Brands /></Suspense>} />
                  <Route path="/seo-engine" element={<RequireAuth><Suspense fallback={null}><SeoEngine /></Suspense></RequireAuth>} />
                  <Route path="/seo-keywords" element={<RequireAuth><Suspense fallback={null}><SeoKeywords /></Suspense></RequireAuth>} />
                  <Route path="/seo-blog-plans" element={<RequireAuth><Suspense fallback={null}><SeoBlogPlans /></Suspense></RequireAuth>} />
                  <Route path="/seo-link-mesh" element={<RequireAuth><Suspense fallback={null}><SeoLinkMesh /></Suspense></RequireAuth>} />
                  <Route path="/drive-watcher" element={<RequireAuth><DriveWatcher /></RequireAuth>} />
                  <Route path="/auto-ingest" element={<RequireAuth><Suspense fallback={null}><AutoIngest /></Suspense></RequireAuth>} />
                  <Route path="/sonic-knowledge" element={<RequireAuth><SonicKnowledge /></RequireAuth>} />
                  <Route path="/functions" element={<Suspense fallback={null}><FunctionsCatalog /></Suspense>} />
                  <Route path="/agent" element={<RequireAuth><Suspense fallback={null}><Agent /></Suspense></RequireAuth>} />
                  <Route path="/approvals" element={<RequireAuth><Suspense fallback={null}><Approvals /></Suspense></RequireAuth>} />
                  <Route path="/m/approvals" element={<RequireAuth><Suspense fallback={null}><MobileApprovals /></Suspense></RequireAuth>} />
                  <Route path="/audit-log" element={<RequireAuth><Suspense fallback={null}><AuditLog /></Suspense></RequireAuth>} />
                  <Route path="/settings/claude-connector" element={<RequireAuth><ClaudeConnector /></RequireAuth>} />
                  <Route path="/settings/claude-activity" element={<RequireAuth><ClaudeActivity /></RequireAuth>} />
                  <Route
                    path="/google-shopping"
                    element={
                      <Suspense fallback={null}>
                        <GoogleShoppingHub />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/pricing-intelligence"
                    element={
                      <Suspense fallback={null}>
                        <PricingIntelligence />
                      </Suspense>
                    }
                  />
                  <Route
                    path="/tools/feed-health"
                    element={
                      <RequireAuth>
                        <Suspense fallback={null}>
                          <FeedHealthPanel onBack={() => window.history.back()} />
                        </Suspense>
                      </RequireAuth>
                    }
                  />
                  <Route path="/review" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/enrich" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/publish" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/capture" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/price" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/analyse" element={<Index initialTab="analytics" />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
                <InstallAppBanner />
                <EmbeddedAuthHealthCheck />
                <AskSonicAI />
                <ClaudePopupButton />
                </AgentNotificationsProvider>
              </BrowserRouter>
            </PromptDialogProvider>
          </ConfirmDialogProvider>
        </BarcodeProvider>
      </ShopifyEmbeddedProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
