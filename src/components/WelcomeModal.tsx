import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  BellRing,
  Check,
  Copy,
  Gift,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { getPublicWelcomeContent } from "@/lib/notifications.functions";

type WelcomeContent = {
  isEnabled: boolean;
  title: string;
  subtitle: string;
  communityUrl: string | null;
  communityLabel: string;
  coupon: { code: string; discountPercent: number } | null;
};

const SEEN_KEY = "zeoxy_welcome_seen_v1";
const TEST_MODE = false; // Set to false after testing.

/**
 * Protect against the welcome popup being mounted by more than one SiteHeader
 * or layout at the same time. Only one instance may own the popup.
 */
let activeWelcomeModalInstance: symbol | null = null;

function markWelcomeAsSeen() {
  if (TEST_MODE) return;

  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Storage can be disabled; the in-memory dismissal guard still applies.
  }
}

export function WelcomeModal() {
  const getContent = useServerFn(getPublicWelcomeContent);
  const getContentRef = useRef(getContent);
  const instanceIdRef = useRef(Symbol("zeoxy-welcome-modal"));
  const dismissedRef = useRef(false);

  const [isOwner, setIsOwner] = useState(false);
  const [content, setContent] = useState<WelcomeContent | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getContentRef.current = getContent;
  }, [getContent]);

  useEffect(() => {
    const instanceId = instanceIdRef.current;

    // Another mounted instance already owns the popup.
    if (
      activeWelcomeModalInstance &&
      activeWelcomeModalInstance !== instanceId
    ) {
      return;
    }

    activeWelcomeModalInstance = instanceId;
    setIsOwner(true);

    let cancelled = false;
    let timer: number | undefined;

    const releaseOwnership = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (activeWelcomeModalInstance === instanceId) {
        activeWelcomeModalInstance = null;
      }
    };

    if (!TEST_MODE) {
      try {
        if (window.localStorage.getItem(SEEN_KEY) === "1") {
          return releaseOwnership;
        }
      } catch {
        // Storage can be disabled; the popup can still show for this visit.
      }
    }

    timer = window.setTimeout(async () => {
      if (cancelled || dismissedRef.current) return;

      setLoading(true);

      try {
        const result = await getContentRef.current();

        if (cancelled || dismissedRef.current || !result.isEnabled) return;

        setContent(result);
        markWelcomeAsSeen();
        setOpen(true);
      } catch (error) {
        if (cancelled || dismissedRef.current) return;

        console.error("[Welcome modal] Could not load public welcome content", error);

        setContent({
          isEnabled: true,
          title: "Welcome to Zeoxy Store",
          subtitle:
            "Your game top-ups, store offers and important updates — all in one place.",
          communityUrl: null,
          communityLabel: "Join our community",
          coupon: null,
        });

        markWelcomeAsSeen();
        setOpen(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 900);

    return () => {
      cancelled = true;
      releaseOwnership();
    };
  }, []);

  // Stop the page behind the popup from scrolling while it is open.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function dismiss() {
    dismissedRef.current = true;
    markWelcomeAsSeen();
    setOpen(false);
  }

  async function copyCoupon() {
    if (!content?.coupon?.code) return;

    try {
      await navigator.clipboard.writeText(content.coupon.code);
      toast.success("Coupon code copied");
    } catch {
      toast.error("Could not copy the code. Please copy it manually.");
    }
  }

  if (!isOwner || !open || !content || loading) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#050817]/25 p-3 backdrop-blur-[2px] sm:p-5"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        className="relative isolate w-full max-w-md min-w-0 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/20 bg-[#121a36]/90 p-4 shadow-[0_20px_70px_rgba(0,0,0,.32)] backdrop-blur-2xl sm:max-h-[calc(100dvh-2.5rem)] sm:p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zeoxy-welcome-title"
      >
        {/* Soft glass highlights */}
        <div className="pointer-events-none absolute -right-16 -top-20 size-48 rounded-full bg-violet/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 size-44 rounded-full bg-cyan/10 blur-3xl" />

        <div className="relative min-w-0">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-cyan/25 bg-cyan/10 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[.16em] text-cyan">
              <Sparkles className="size-3 shrink-0" />
              <span>Welcome to Zeoxy</span>
            </span>

            <button
              type="button"
              onClick={dismiss}
              aria-label="Close welcome popup"
              title="Close"
              className="grid size-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/10 text-slate-200 transition hover:border-white/25 hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan/50"
            >
              <X className="size-4" />
            </button>
          </div>

          <h2
            id="zeoxy-welcome-title"
            className="mt-3 break-words font-display text-lg font-bold leading-tight text-white sm:text-xl"
          >
            {content.title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-200/90">
            {content.subtitle}
          </p>

          {content.coupon ? (
            <div className="mt-3 min-w-0 rounded-xl border border-lime-200/25 bg-lime-200/[.08] p-3 backdrop-blur-md">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[.14em] text-lime-200">
                  <Gift className="size-3.5 shrink-0" />
                  Live coupon
                </span>
                <span className="shrink-0 rounded-full border border-lime-200/20 bg-lime-200/10 px-2 py-0.5 text-[9px] font-semibold text-lime-100">
                  Currently active
                </span>
              </div>

              <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-all font-display text-lg font-bold tracking-[.1em] text-lime-200">
                    {content.coupon.code}
                  </p>
                  <p className="mt-0.5 text-[10px] text-slate-200/80">
                    Up to {content.coupon.discountPercent}% off eligible packages
                  </p>
                </div>

                <button
                  type="button"
                  onClick={copyCoupon}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-lime-200/25 bg-lime-200/10 px-3 py-2 text-[10px] font-semibold text-lime-100 transition hover:bg-lime-200/15"
                >
                  <Copy className="size-3" />
                  Copy code
                </button>
              </div>

              <p className="mt-2 text-[9px] leading-relaxed text-slate-300/75">
                Actual savings depend on the package's available Smile Coin
                profit margin. Some packages may receive a smaller discount.
              </p>
            </div>
          ) : null}

          <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
            <div className="min-w-0 rounded-xl border border-white/15 bg-white/[.07] p-2.5 backdrop-blur-md">
              <div className="grid size-7 place-items-center rounded-lg bg-violet/15 text-violet-200">
                <BellRing className="size-3.5" />
              </div>
              <p className="mt-1.5 font-display text-xs font-semibold text-white">
                Stay in the loop
              </p>
              <p className="mt-1 break-words text-[10px] leading-relaxed text-slate-300/85">
                Get store announcements, offers and important updates.
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-white/15 bg-white/[.07] p-2.5 backdrop-blur-md">
              <div className="grid size-7 place-items-center rounded-lg bg-cyan/15 text-cyan">
                <Users className="size-3.5" />
              </div>
              <p className="mt-1.5 font-display text-xs font-semibold text-white">
                Join the community
              </p>
              <p className="mt-1 break-words text-[10px] leading-relaxed text-slate-300/85">
                Keep up with Zeoxy news and new store updates.
              </p>

              {content.communityUrl ? (
                <a
                  href={content.communityUrl}
                  target={
                    content.communityUrl.startsWith("/") ? undefined : "_blank"
                  }
                  rel="noreferrer"
                  onClick={dismiss}
                  className="mt-2 inline-flex max-w-full items-center gap-1 break-words text-[10px] font-semibold text-cyan hover:underline"
                >
                  {content.communityLabel}
                  <ArrowRight className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="mt-2 inline-flex text-[9px] text-slate-400">
                  Community link coming soon
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={dismiss}
            className="brand-gradient mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-xs font-semibold text-ink shadow-lg shadow-violet/10 transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-cyan/50"
          >
            Explore Zeoxy Store
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </section>
    </div>
  );
}


