import { useEffect, useState, type ImgHTMLAttributes } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const SITE_LOGO_QUERY_KEY = ["site-logo-url"] as const;

async function fetchSiteLogoUrl(): Promise<string | null> {
  const { data, error } = await (supabase as any)
    .from("site_settings")
    .select("logo_url")
    .eq("id", true)
    .maybeSingle();

  if (error) {
    console.error("[site-logo] Supabase logo lookup failed:", error);
    throw error;
  }

  const url = typeof data?.logo_url === "string" ? data.logo_url.trim() : "";
  if (!url) {
    console.warn("[site-logo] site_settings.logo_url is empty.");
    return null;
  }

  return url;
}

function useSiteLogoUrl() {
  return useQuery({
    queryKey: SITE_LOGO_QUERY_KEY,
    queryFn: fetchSiteLogoUrl,
    staleTime: 60_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    retry: 2,
    retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 2_000),
  });
}

type SiteLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

/**
 * Only displays the URL saved in Supabase.
 * Existing cached data remains visible during background refreshes.
 * If Supabase has no logo or the image fails, nothing is substituted.
 */
export function SiteLogo({
  alt = "ZEXY STORE",
  onError,
  ...props
}: SiteLogoProps) {
  const { data } = useSiteLogoUrl();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    setFailedUrl(null);
  }, [data]);

  if (!data || failedUrl === data) return null;

  return (
    <img
      {...props}
      src={data}
      alt={alt}
      onError={(event) => {
        console.error("[site-logo] Saved Supabase image URL failed to load:", data);
        setFailedUrl(data);
        onError?.(event);
      }}
    />
  );
}

function faviconMimeType(url: string): string | undefined {
  const pathname = url.split("?")[0]?.toLowerCase() ?? "";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  if (pathname.endsWith(".avif")) return "image/avif";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  return undefined;
}

function cacheBustedFaviconUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("favicon_version", "zexy-logo-v1");
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Uses only the saved Supabase logo URL for the browser favicon.
 * No public-folder or hardcoded favicon is used as a fallback.
 */
export function SiteFavicon() {
  const { data, isSuccess, isError } = useSiteLogoUrl();

  useEffect(() => {
    const existing = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );

    // During the first fetch, don't remove an icon already applied from a
    // previously successful Supabase response. Static declarations are
    // removed once the lookup has a definitive result.
    if (!isSuccess && !isError) return;

    if (!data) {
      existing.forEach((link) => link.remove());
      return;
    }

    let favicon = document.querySelector<HTMLLinkElement>(
      'link[data-site-logo-favicon="true"]',
    );

    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      favicon.dataset.siteLogoFavicon = "true";
      document.head.appendChild(favicon);
    }

    favicon.href = cacheBustedFaviconUrl(data);
    const mime = faviconMimeType(data);
    if (mime) favicon.type = mime;
    else favicon.removeAttribute("type");

    existing.forEach((link) => {
      if (link !== favicon) link.remove();
    });
  }, [data, isSuccess, isError]);

  return null;
}
