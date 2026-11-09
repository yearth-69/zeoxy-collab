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
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, RefreshCw, Wrench } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { maintenanceSettingsQuery } from "@/lib/store";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider } from "../lib/theme";
import { Toaster } from "@/components/ui/sonner";
import { WelcomeModal } from "@/components/WelcomeModal";
import { SiteFavicon } from "@/components/SiteLogoProvider";

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
        <SiteFavicon />
        <MaintenanceGate />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function MaintenanceGate() {
  const { isAdmin, ready } = useAuth();
  const [bootDeadlinePassed, setBootDeadlinePassed] = useState(false);
  const [loaderFinished, setLoaderFinished] = useState(false);

  // Safety ceiling: slow/unavailable auth or settings must not trap visitors forever.
  useEffect(() => {
    const timer = window.setTimeout(() => setBootDeadlinePassed(true), 6_500);
    return () => window.clearTimeout(timer);
  }, []);

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
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
    retryDelay: 800,
  });

  const search = location.search as Record<string, unknown>;
  const restrictedAdminLogin =
    location.pathname === "/auth" && search["maintenanceAdmin"] === "1";

  // Restricted sign-in remains reachable during maintenance.
  if (restrictedAdminLogin) return <Outlet />;

  // The loader reaches 100 only after auth + maintenance checks settle,
  // or after the safety ceiling takes the availability fallback path.
  const startupReady =
    (!isPending && ready) ||
    bootDeadlinePassed ||
    (isError && !settings);

  // Do not mount the actual site (Outlet) until the loader reports 100%.
  if (!loaderFinished) {
    return (
      <StoreLoadingScreen
        canComplete={startupReady}
        onComplete={() => setLoaderFinished(true)}
      />
    );
  }

  // If checks exceeded the safety ceiling, allow the storefront rather than
  // leaving customers stuck indefinitely. Admin status itself remains fail-closed.
  if ((isPending || !ready) && !isAdmin) {
    console.warn(
      "[startup] Startup safety timeout reached; showing the store after loader reached 100%.",
    );
    return <><Outlet /><WelcomeModal /></>;
  }

  // If settings could not be fetched, keep the store usable while queries retry.
  if (isError && !settings && !isAdmin) {
    console.warn(
      "[startup] Maintenance status unavailable; allowing storefront while the query retries.",
    );
    return <><Outlet /><WelcomeModal /></>;
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

function StoreLoadingScreen({
  canComplete,
  onComplete,
}: {
  canComplete: boolean;
  onComplete: () => void;
}) {
  const percentageRef = useRef<HTMLSpanElement>(null);
  const progressFillRef = useRef<HTMLDivElement>(null);
  const progressTrackRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);

  onCompleteRef.current = onComplete;

  useEffect(() => {
    let frameId = 0;
    let previousTime = 0;
    let progress = 0;
    let completionHoldStartedAt: number | null = null;

    const renderProgress = (value: number) => {
      const safeValue = Math.max(0, Math.min(100, value));
      const rounded = Math.floor(safeValue);

      if (progressFillRef.current) {
        progressFillRef.current.style.width = `${safeValue}%`;
      }
      if (percentageRef.current) {
        percentageRef.current.textContent = `${rounded}%`;
      }
      if (progressTrackRef.current) {
        progressTrackRef.current.setAttribute("aria-valuenow", String(rounded));
      }
    };

    const animate = (now: number) => {
      if (!previousTime) previousTime = now;
      // Cap large frame gaps after tab switching so the loader doesn't jump.
      const deltaSeconds = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;

      if (canComplete) {
        // Once startup checks are complete, smoothly finish from the current
        // percentage to 100 in roughly half a second.
        progress = Math.min(100, progress + deltaSeconds * 120);
      } else if (progress < 68) {
        progress = Math.min(68, progress + deltaSeconds * 38);
      } else if (progress < 90) {
        progress = Math.min(90, progress + deltaSeconds * 15);
      } else if (progress < 94) {
        progress = Math.min(94, progress + deltaSeconds * 4);
      }

      renderProgress(progress);

      if (progress >= 100) {
        if (completionHoldStartedAt === null) {
          completionHoldStartedAt = now;
        } else if (
          now - completionHoldStartedAt >= 180 &&
          !completedRef.current
        ) {
          completedRef.current = true;
          onCompleteRef.current();
          return;
        }
      }

      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [canComplete]);

  return (
    <main
      role="status"
      aria-label="Loading ZEXY STORE"
      aria-live="polite"
      className="relative isolate flex min-h-screen min-h-[100svh] flex-col items-center justify-between overflow-hidden bg-[#070b1b] px-6 pb-[12vh] pt-[15vh] text-center text-white"
    >
      <style>{`
        @keyframes zexy-letter-in {
          0% {
            opacity: 0;
            transform: translate3d(0, 24px, 0) rotate(-8deg) scale(.88);
          }
          68% {
            opacity: 1;
            transform: translate3d(0, -2px, 0) rotate(1.5deg) scale(1.025);
          }
          100% {
            opacity: 1;
            transform: translate3d(0, 0, 0) rotate(0) scale(1);
          }
        }
        @keyframes zexy-progress-glow {
          0%, 100% { opacity: .72; }
          50% { opacity: 1; }
        }
        .zexy-loader-letter {
          display: inline-block;
          opacity: 0;
          backface-visibility: hidden;
          transform: translateZ(0);
          will-change: transform, opacity;
          animation: zexy-letter-in 780ms cubic-bezier(.2,.75,.25,1) forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .zexy-loader-letter {
            opacity: 1;
            animation: none;
            transform: none;
            will-change: auto;
          }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 28%, rgba(111,72,255,.15), transparent 38%), radial-gradient(ellipse at 50% 82%, rgba(0,211,226,.08), transparent 42%)",
        }}
      />

      <div className="relative mt-[3vh] flex flex-col items-center">
        <h1
          aria-label="ZEXY"
          className="select-none whitespace-nowrap font-serif text-[clamp(5rem,17vw,8.5rem)] font-bold italic leading-none tracking-[-.055em] text-[#F1E5D7]"
          style={{
            fontFamily: '"Brush Script MT", "Segoe Script", "Apple Chancery", cursive',
            textShadow: "0 5px 36px rgba(190,155,255,.17)",
          }}
        >
          {"ZEXY".split("").map((letter, index) => (
            <span
              key={`${letter}-${index}`}
              aria-hidden="true"
              className="zexy-loader-letter"
              style={{ animationDelay: `${index * 120}ms` }}
            >
              {letter}
            </span>
          ))}
        </h1>
      </div>

      <div className="relative flex w-full max-w-[190px] flex-col items-center">
        <div className="mb-3 flex items-baseline justify-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[.28em] text-slate-400">
            Loading
          </span>
          <span
            ref={percentageRef}
            className="min-w-[3.5rem] text-right font-display text-[2rem] font-semibold tabular-nums tracking-tight text-[#F1E5D7]"
            style={{
              animation: "zexy-progress-glow 1.8s ease-in-out infinite",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            0%
          </span>
        </div>

        <div
          ref={progressTrackRef}
          className="h-[3px] w-full overflow-hidden rounded-full bg-white/15"
          role="progressbar"
          aria-label="Startup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
        >
          <div
            ref={progressFillRef}
            className="h-full rounded-full bg-gradient-to-r from-violet-300 via-[#F1E5D7] to-cyan-200"
            style={{
              width: "0%",
              boxShadow: "0 0 14px rgba(186,230,253,.4)",
              transform: "translateZ(0)",
              willChange: "width",
            }}
          />
        </div>
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
