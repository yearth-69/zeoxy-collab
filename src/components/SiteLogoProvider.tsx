import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const SITE_LOGO_QUERY_KEY = ["site-logo-url"] as const;
const DEFAULT_LOGO = "/logo.jpeg";

async function fetchSiteLogoUrl(): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from("site_settings")
    .select("logo_url")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("[site-logo] Could not load website logo:", error);
    throw error;
  }

  return typeof data?.logo_url === "string" && data.logo_url.trim()
    ? data.logo_url.trim()
    : null;
}

function useSiteLogoUrl() {
  return useQuery({
    queryKey: SITE_LOGO_QUERY_KEY,
    queryFn: fetchSiteLogoUrl,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

type SiteLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

export function SiteLogo({ alt = "ZEXY STORE", onError, ...props }: SiteLogoProps) {
  const { data } = useSiteLogoUrl();
  const source = data || DEFAULT_LOGO;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const displayedSource = failedSource === source ? DEFAULT_LOGO : source;

  return (
    <img
      {...props}
      src={displayedSource}
      alt={alt}
      onError={(event) => {
        if (displayedSource !== DEFAULT_LOGO) setFailedSource(source);
        onError?.(event);
      }}
    />
  );
}

/**
 * Updates the browser tab icon from the same admin-managed logo URL.
 * Runs only in the browser; the static root favicon remains the fallback.
 */
export function SiteFavicon() {
  const { data } = useSiteLogoUrl();

  useEffect(() => {
    const href = data || DEFAULT_LOGO;
    const existing = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );

    const links = existing.length
      ? existing
      : [Object.assign(document.createElement("link"), { rel: "icon" })];

    for (const link of links) {
      link.href = href;
      const path = href.split("?")[0].toLowerCase();
      if (path.endsWith(".png")) link.type = "image/png";
      else if (path.endsWith(".webp")) link.type = "image/webp";
      else if (path.endsWith(".gif")) link.type = "image/gif";
      else if (path.endsWith(".avif")) link.type = "image/avif";
      else if (path.endsWith(".svg")) link.type = "image/svg+xml";
      else link.type = "image/jpeg";
      if (!link.isConnected) document.head.appendChild(link);
    }
  }, [data]);

  return null;
}
