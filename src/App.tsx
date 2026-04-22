import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ShopifyEmbeddedProvider from "@/components/ShopifyEmbeddedProvider";
import EmbeddedAuthHealthCheck from "@/components/EmbeddedAuthHealthCheck";
import InstallAppBanner from "@/components/InstallAppBanner";
import BarcodeProvider from "@/components/BarcodeProvider";
import Index from "./pages/Index.tsx";
import Landing from "./pages/Landing.tsx";
import Login from "./pages/Login.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import AuthCallbackPage from "./pages/AuthCallback.tsx";
import NotFound from "./pages/NotFound.tsx";
import Support from "./pages/Support.tsx";
import Privacy from "./pages/Privacy.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ShopifyEmbeddedProvider>
        <BarcodeProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/dashboard" element={<Index />} />
              <Route path="/dashboard/*" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/settings" element={<Index initialTab="account" />} />
              <Route path="/account" element={<Index initialTab="account" />} />
              <Route path="/billing" element={<Index initialTab="billing" />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/auth/xero/callback" element={<AuthCallbackPage />} />
              <Route path="/auth/myob/callback" element={<AuthCallbackPage />} />
              <Route path="/auth/lightspeed-x/callback" element={<AuthCallbackPage />} />
              <Route path="/auth/lightspeed-r/callback" element={<AuthCallbackPage />} />
              <Route path="/support" element={<Support />} />
              <Route path="/privacy" element={<Privacy />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
          <InstallAppBanner />
          <EmbeddedAuthHealthCheck />
        </BarcodeProvider>
      </ShopifyEmbeddedProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
