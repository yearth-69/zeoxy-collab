import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const DEFAULT_LOGO = "/logo.jpeg";
const SITE_LOGO_QUERY_KEY = ["site-logo-url"] as const;
const SiteLogoContext = createContext<string>(DEFAULT_LOGO);

type SiteLogoProviderProps = { children: ReactNode };

export function SiteLogoProvider({ children }: SiteLogoProviderProps) {
  const { data } = useQuery({
    queryKey: SITE_LOGO_QUERY_KEY,
    queryFn: async (): Promise<string | null> => {
      const { data: row, error } = await (supabase as any)
        .from("site_settings")
        .select("logo_url")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return typeof row?.logo_url === "string" && row.logo_url.trim()
        ? row.logo_url.trim()
        : null;
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const logoUrl = data || DEFAULT_LOGO;

  useEffect(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );
    for (const link of links) {
      link.href = logoUrl;
      const lower = logoUrl.toLowerCase();
      link.type = lower.endsWith(".svg")
        ? "image/svg+xml"
        : lower.endsWith(".webp")
          ? "image/webp"
          : lower.endsWith(".png")
            ? "image/png"
            : lower.endsWith(".gif")
              ? "image/gif"
              : lower.endsWith(".avif")
                ? "image/avif"
                : "image/jpeg";
    }
  }, [logoUrl]);

  return (
    <SiteLogoContext.Provider value={logoUrl}>
      {children}
    </SiteLogoContext.Provider>
  );
}

export function useSiteLogo() {
  return useContext(SiteLogoContext);
}

export function SiteLogo({
  alt = "ZEXY STORE",
  className = "h-9 w-9 object-contain",
  width,
  height,
}: {
  alt?: string;
  className?: string;
  width?: number;
  height?: number;
}) {
  const src = useSiteLogo();
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={(event) => {
        if (event.currentTarget.src.endsWith(DEFAULT_LOGO)) return;
        event.currentTarget.src = DEFAULT_LOGO;
      }}
    />
  );
}
