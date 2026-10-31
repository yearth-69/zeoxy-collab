import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  BellRing,
  Sparkles,
  TicketPercent,
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

/**
 * This guard survives SPA route changes and resets on a full browser reload.
 * It also prevents two mounted SiteHeader instances from opening two popups.
 */
let welcomePopupClaimedForDocument = false;

const POPUP_TITLE = "DON'T MISS THE NEXT DROP!";
const POPUP_SUBTITLE =
  "Join the official Zeoxy WhatsApp Channel and unlock access to exclusive deals, coupon giveaways and the latest updates.";

export function WelcomeModal() {
  const getContent = useServerFn(getPublicWelcomeContent);
  const getContentRef = useRef(getContent);
  const dismissedRef = useRef(false);
  const claimedByThisInstanceRef = useRef(false);
  const mountedRef = useRef(false);

  const [content, setContent] = useState<WelcomeContent | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getContentRef.current = getContent;
  }, [getContent]);

  useEffect(() => {
    // React StrictMode runs effect setup/cleanup/setup on the same instance.
    if (claimedByThisInstanceRef.current) {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
      };
    }

    if (welcomePopupClaimedForDocument) return;

    welcomePopupClaimedForDocument = true;
    claimedByThisInstanceRef.current = true;
    mountedRef.current = true;

    window.setTimeout(async () => {
      if (!mountedRef.current || dismissedRef.current) return;

      setLoading(true);
      try {
        const result = await getContentRef.current();
        if (!mountedRef.current || dismissedRef.current || !result.isEnabled) {
          return;
        }

        setContent(result);
        setOpen(true);
      } catch (error) {
        if (!mountedRef.current || dismissedRef.current) return;

        console.error("[Welcome modal] Could not load public welcome content", error);
        setContent({
          isEnabled: true,
          title: POPUP_TITLE,
          subtitle: POPUP_SUBTITLE,
          communityUrl: null,
          communityLabel: "JOIN WHATSAPP CHANNEL",
          coupon: null,
        });
        setOpen(true);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }, 900);

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Lock the page behind the welcome dialog, while preserving prior inline style.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, [open]);

  function dismiss() {
    dismissedRef.current = true;
    setOpen(false);
  }

  function joinCommunity() {
    if (!content?.communityUrl) {
      toast.info("WhatsApp channel link has not been configured yet.");
      return;
    }
    dismiss();
  }

  if (!open || !content || loading) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#050817]/35 p-3 backdrop-blur-[3px] sm:p-5"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        className="relative isolate w-full max-w-md min-w-0 max-h-[calc(100dvh-1.5rem)] overflow-hidden rounded-[1.5rem] border border-white/15 bg-[#101b34]/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,.48)] backdrop-blur-2xl sm:p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="zeoxy-welcome-title"
      >
        <div className="pointer-events-none absolute -right-20 -top-24 size-56 rounded-full bg-violet/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-20 size-52 rounded-full bg-cyan/10 blur-3xl" />

        <div className="relative min-w-0">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              <Sparkles className="size-3.5 fill-current" />
              Exclusive Access
            </span>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Close welcome popup"
              title="Close"
              className="grid size-8 shrink-0 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Add the transparent artwork at public/welcome-popup-art.png (600×300). */}
          <div className="relative mt-2.5 flex aspect-[2/1] w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#18295a] via-[#111d45] to-[#09152d]">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(59,130,246,.35),transparent_65%)]" />
            <img
              src="/welcome-popup-art.png"
              alt="Zeoxy exclusive coupons and rewards"
              width={600}
              height={300}
              className="relative z-[1] h-full w-full object-contain"
              onError={(event) => {
                // Keep the styled banner placeholder until the user adds the artwork.
                event.currentTarget.style.display = "none";
              }}
            />
          </div>

          <h2
            id="zeoxy-welcome-title"
            className="mt-3 font-display text-xl font-bold leading-tight text-white sm:text-2xl"
          >
            {content.title?.trim() && content.title !== "Welcome to Zeoxy Store"
              ? content.title
              : POPUP_TITLE}
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-300 sm:text-sm">
            {content.subtitle?.trim() &&
            content.subtitle !==
              "Your game top-ups, store offers and important updates — all in one place."
              ? content.subtitle
              : POPUP_SUBTITLE}
          </p>

          <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
            <div className="min-w-0 rounded-2xl border border-white/[.06] bg-[#23324f]/85 p-3">
              <TicketPercent className="size-5 text-violet-400" />
              <p className="mt-2 font-display text-sm font-semibold text-white">
                Exclusive Coupons
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                Special discounts and coupon giveaways.
              </p>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/[.06] bg-[#23324f]/85 p-3">
              <BellRing className="size-5 text-cyan-400" />
              <p className="mt-2 font-display text-sm font-semibold text-white">
                Latest Updates
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                Offers, announcements and new drops.
              </p>
            </div>
          </div>

          {content.communityUrl ? (
            <a
              href={content.communityUrl}
              target={content.communityUrl.startsWith("/") ? undefined : "_blank"}
              rel="noreferrer"
              onClick={joinCommunity}
              className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#18cf69] px-4 py-3 text-center font-display text-sm font-bold uppercase text-[#062b19] shadow-lg shadow-emerald-500/10 transition hover:bg-[#20df75] focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#101b34]"
            >
              Join WhatsApp Channel
              <ArrowRight className="size-4" />
            </a>
          ) : (
            <button
              type="button"
              onClick={joinCommunity}
              className="mt-3 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[#18cf69] px-4 py-3 text-center font-display text-sm font-bold uppercase text-[#062b19] opacity-90"
            >
              Join WhatsApp Channel
              <ArrowRight className="size-4" />
            </button>
          )}

          <p className="mt-2.5 text-center text-[10px] text-slate-400">
            Free to join · Stay updated · Never miss a deal
          </p>
        </div>
      </section>
    </div>
  );
}




