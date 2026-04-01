import { ReactNode, createContext, useContext, useMemo } from "react";
import { isShopifyEmbedded, getShopFromUrl, getHostFromUrl, getApiKey } from "@/lib/shopify-embedded";

interface EmbeddedContextValue {
  isEmbedded: boolean;
  shop: string | null;
  host: string | null;
  apiKey: string;
}

const EmbeddedContext = createContext<EmbeddedContextValue>({
  isEmbedded: false,
  shop: null,
  host: null,
  apiKey: "",
});

export const useShopifyEmbedded = () => useContext(EmbeddedContext);

interface Props {
  children: ReactNode;
}

/**
 * Wraps the app and provides embedded-mode context.
 * When running inside Shopify Admin, initialises App Bridge.
 * When running standalone, passes through without changes.
 */
const ShopifyEmbeddedProvider = ({ children }: Props) => {
  const value = useMemo<EmbeddedContextValue>(() => ({
    isEmbedded: isShopifyEmbedded(),
    shop: getShopFromUrl(),
    host: getHostFromUrl(),
    apiKey: getApiKey(),
  }), []);

  if (value.isEmbedded && value.apiKey && value.host) {
    // When embedded, load App Bridge via the script tag approach (v4)
    // The shopify-app-bridge script is loaded in index.html
    return (
      <EmbeddedContext.Provider value={value}>
        <div className="shopify-embedded-app">
          {children}
        </div>
      </EmbeddedContext.Provider>
    );
  }

  // Standalone mode — no App Bridge wrapping
  return (
    <EmbeddedContext.Provider value={value}>
      {children}
    </EmbeddedContext.Provider>
  );
};

export default ShopifyEmbeddedProvider;
