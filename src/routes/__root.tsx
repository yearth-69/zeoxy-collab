import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, RefreshCw, Wrench } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { maintenanceSettingsQuery } from "@/lib/store";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider } from "../lib/theme";
import { Toaster } from "@/components/ui/sonner";
import { WelcomeModal } from "@/components/WelcomeModal";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-panel max-w-md rounded-3xl p-8 text-center">
        <h1 className="font-display text-6xl font-semibold brand-text">404</h1>
        <h2 className="mt-4 font-display text-lg font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-subtle">
          This page doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="brand-gradient inline-flex items-center justify-center rounded-xl px-4 py-2.5 font-display text-sm font-semibold text-ink"
          >
            Back to store
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({
  error,
  reset,
}: {
  error: unknown;
  reset: () => void;
}) {
  console.error(error);

  const router = useRouter();

  useEffect(() => {
    if (error instanceof Error) {
      reportLovableError(error, {
        boundary: "tanstack_root_error_component",
      });
    } else {
      reportLovableError(new Error(String(error)), {
        boundary: "tanstack_root_error_component",
      });
    }
  }, [error]);

  return (
    <div>
      <h1>Something went wrong</h1>
      <p></p>

      <button onClick={reset}>
        Try again
      </button>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ZEXY STORE" },
      {
        name: "description",
        content:
          "Buy game diamonds, gems and passes in seconds with instant delivery.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap",
      },

      {
        rel: "icon",
        href: "/zeoxy-favicon.jpeg",
        type: "image/svg+xml",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MaintenanceGate />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function MaintenanceGate() {
  const { isAdmin, ready } = useAuth();
  const location = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      search: state.location.search,
    }),
  });
  const {
    data: settings,
    isPending,
    isError,
    refetch,
  } = useQuery({
    ...maintenanceSettingsQuery(),
    // Keep maintenance status fresh without repeatedly downloading all site settings.
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const search = location.search as Record<string, unknown>;
  const restrictedAdminLogin =
    location.pathname === "/auth" && search["maintenanceAdmin"] === "1";

  // Only the restricted sign-in route is public while maintenance is active.
  if (restrictedAdminLogin) return <Outlet />;

  // Avoid briefly exposing the store before auth and maintenance settings load.
  if (isPending || !ready) {
    if (isAdmin) {
      return <><Outlet /><WelcomeModal /></>;
    }
    return <MaintenanceChecking />;
  }

  // Fail closed if maintenance status cannot be checked; admins retain access.
  if (isError && !isAdmin) {
    return <MaintenancePage onRetry={() => void refetch()} />;
  }

  if (settings?.maintenance_enabled && !isAdmin) {
    return (
      <MaintenancePage
        message={settings.maintenance_message}
        maintenanceUntil={settings.maintenance_until}
        onRetry={() => void refetch()}
      />
    );
  }

  return <><Outlet /><WelcomeModal /></>;
}

function MaintenanceChecking() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#080d20] px-5 py-10 text-center text-white">
      <div className="pointer-events-none absolute -left-24 -top-24 size-80 rounded-full bg-violet-600/15 blur-3xl" />
      <div className="relative flex flex-col items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-cyan-300">
          <Wrench className="size-5 animate-pulse" />
        </span>
        <p className="text-sm text-slate-300">Checking ZEXY STORE status…</p>
      </div>
    </main>
  );
}

function MaintenancePage({
  message,
  maintenanceUntil,
  onRetry,
}: {
  message?: string;
  maintenanceUntil?: string | null;
  onRetry: () => void;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const target = maintenanceUntil ? new Date(maintenanceUntil).getTime() : NaN;
  const hasCountdown = Number.isFinite(target);
  const remaining = hasCountdown && now !== null
    ? Math.max(0, Math.floor((target - now) / 1_000))
    : null;
  const days = remaining === null ? 0 : Math.floor(remaining / 86_400);
  const hours = remaining === null ? 0 : Math.floor((remaining % 86_400) / 3_600);
  const minutes = remaining === null ? 0 : Math.floor((remaining % 3_600) / 60);
  const seconds = remaining === null ? 0 : remaining % 60;
  const time = [String(hours + days * 24).padStart(2, "0"), String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0")].join(":");
  const expired = hasCountdown && remaining === 0;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070c1d] px-5 py-12 text-white">
      <div className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-violet-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 size-96 rounded-full bg-cyan-500/10 blur-3xl" />
      <section className="relative w-full max-w-xl rounded-3xl border border-white/10 bg-[#111a34]/85 p-6 text-center shadow-[0_24px_90px_rgba(0,0,0,.45)] backdrop-blur-2xl sm:p-10">
        <div className="mx-auto grid size-16 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-200 shadow-lg shadow-cyan-950/20">
          <Wrench className="size-7" />
        </div>
        <span className="mt-5 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-300/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.18em] text-violet-200">
          <span className="size-1.5 animate-pulse rounded-full bg-violet-300" />
          Scheduled maintenance
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">We&apos;ll be back soon!</h1>
        <p className="mx-auto mt-3 max-w-md whitespace-pre-wrap text-sm leading-7 text-slate-300">
          {message?.trim() || "We're carrying out a little maintenance to make ZEXY STORE better. Please check back soon."}
        </p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-black/15 p-5">
          <div className="flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[.18em] text-slate-400">
            <Clock3 className="size-3.5" /> Estimated time remaining
          </div>
          {hasCountdown ? (
            <>
              <p className="mt-3 font-display text-3xl font-bold tabular-nums tracking-[.08em] text-cyan-200 sm:text-4xl">
                {remaining === null ? "--:--:--" : time}
              </p>
              {days > 0 && remaining !== null ? <p className="mt-2 text-[10px] text-slate-500">{days} day{days === 1 ? "" : "s"} remaining</p> : null}
              {expired ? <p className="mt-3 text-xs leading-relaxed text-amber-200">We&apos;re taking a little longer than expected. The store will reopen once our team disables maintenance.</p> : null}
            </>
          ) : (
            <p className="mt-3 font-display text-base font-semibold text-cyan-100">We&apos;ll be back as soon as possible</p>
          )}
        </div>
        <p className="mt-6 text-xs text-slate-500">Thank you for your patience and support.</p>
        <button type="button" onClick={onRetry} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.045] px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">
          <RefreshCw className="size-3.5" /> Check again
        </button>
        <div className="mt-7 border-t border-white/[.07] pt-4">
          <Link to="/auth" search={{ redirect: "/admin", maintenanceAdmin: "1" }} className="text-[10px] font-medium text-slate-500 transition hover:text-cyan-200">
            Admin access
          </Link>
        </div>
      </section>
    </main>
  );
}
