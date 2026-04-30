import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ShopifyEmbeddedProvider from "@/components/ShopifyEmbeddedProvider";
import EmbeddedAuthHealthCheck from "@/components/EmbeddedAuthHealthCheck";
import InstallAppBanner from "@/components/InstallAppBanner";
import StockyAnnouncementBar from "@/components/StockyAnnouncementBar";
import BarcodeProvider from "@/components/BarcodeProvider";
import { ConfirmDialogProvider } from "@/hooks/use-confirm-dialog";
import { PromptDialogProvider } from "@/hooks/use-prompt-dialog";
import Index from "./pages/Index.tsx";
import Landing from "./pages/Landing.tsx";
import Login from "./pages/Login.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import AuthCallbackPage from "./pages/AuthCallback.tsx";
import NotFound from "./pages/NotFound.tsx";
import Support from "./pages/Support.tsx";
import Unsubscribe from "./pages/Unsubscribe.tsx";
import Privacy from "./pages/Privacy.tsx";
import Health from "./pages/Health.tsx";
import AdminSecrets from "./pages/AdminSecrets.tsx";
import Rules from "./pages/Rules.tsx";
import RulesSetup from "./pages/RulesSetup.tsx";
import { lazy, Suspense } from "react";
const GoogleShoppingHub = lazy(() => import("./components/GoogleShopping/GoogleShoppingHub.tsx"));

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
            <StockyAnnouncementBar />
            <Routes>
              <Route path="/" element={<Landing />} />
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
              <Route path="/health" element={<Health />} />
              <Route path="/admin/secrets" element={<AdminSecrets />} />
              <Route path="/rules" element={<Rules />} />
              <Route path="/rules/setup" element={<RulesSetup />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          <InstallAppBanner />
          <EmbeddedAuthHealthCheck />
            </PromptDialogProvider>
          </ConfirmDialogProvider>
        </BarcodeProvider>
      </ShopifyEmbeddedProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
