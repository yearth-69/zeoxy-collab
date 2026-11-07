import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  BellRing,
  CheckCheck,
  ExternalLink,
  Megaphone,
  Tag,
  Info,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type StoreNotification = {
  id: string;
  title: string;
  message: string;
  type: "offer" | "announcement" | "update";
  link_url: string | null;
  created_at: string;
  isUnread: boolean;
};

const queryKey = (userId: string) => ["zeoxy-notifications", userId] as const;

async function fetchNotifications(userId: string): Promise<StoreNotification[]> {
  const db = supabase as any;

  const [
    { data: notifications, error: notificationError },
    { data: reads, error: readsError },
  ] = await Promise.all([
    db.from("notifications")
      .select("id, title, message, type, link_url, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(30),
    db.from("notification_reads")
      .select("notification_id")
      .eq("user_id", userId),
  ]);

  if (notificationError) throw notificationError;
  if (readsError) throw readsError;

  const readIds = new Set(
    (reads ?? []).map((row: { notification_id: string }) => row.notification_id),
  );

  return (notifications ?? []).map(
    (item: Omit<StoreNotification, "isUnread">) => ({
      ...item,
      isUnread: !readIds.has(item.id),
    }),
  );
}

function TypeIcon({ type }: { type: StoreNotification["type"] }) {
  if (type === "offer") return <Tag className="size-4" />;
  if (type === "announcement") return <Megaphone className="size-4" />;
  return <Info className="size-4" />;
}

function timeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diff = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

export function NotificationBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const userId = user?.id;

  const {
    data: notifications = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: userId ? queryKey(userId) : ["zeoxy-notifications", "guest"],
    queryFn: () => fetchNotifications(userId!),
    enabled: Boolean(userId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const unreadCount = useMemo(
    () => notifications.filter((item) => item.isUnread).length,
    [notifications],
  );

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`zeoxy-notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKey(userId) });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notification_reads",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: queryKey(userId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  async function markRead(item: StoreNotification) {
    if (item.isUnread && userId) {
      const { error } = await (supabase as any)
        .from("notification_reads")
        .upsert(
          {
            notification_id: item.id,
            user_id: userId,
            read_at: new Date().toISOString(),
          },
          { onConflict: "notification_id,user_id" },
        );

      if (error) {
        toast.error("Could not update notification status");
        return;
      }

      await queryClient.invalidateQueries({ queryKey: queryKey(userId) });
    }

    setOpen(false);

    if (item.link_url) {
      if (item.link_url.startsWith("/") && !item.link_url.startsWith("//")) {
        navigate({ to: item.link_url as never });
      } else {
        window.open(item.link_url, "_blank", "noopener,noreferrer");
      }
    }
  }

  async function markAllRead() {
    if (!userId || unreadCount === 0) return;

    const unread = notifications.filter((item) => item.isUnread);
    const { error } = await (supabase as any)
      .from("notification_reads")
      .upsert(
        unread.map((item) => ({
          notification_id: item.id,
          user_id: userId,
          read_at: new Date().toISOString(),
        })),
        { onConflict: "notification_id,user_id" },
      );

    if (error) {
      toast.error("Could not mark notifications as read");
      return;
    }

    await queryClient.invalidateQueries({ queryKey: queryKey(userId) });
    toast.success("All caught up");
  }

  if (!userId) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={
          unreadCount
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative grid size-10 place-items-center rounded-full border border-white/10 bg-white/[.045] text-slate-300 transition hover:border-cyan/30 hover:bg-cyan/10 hover:text-cyan"
      >
        <Bell className="size-[18px]" />

        {unreadCount > 0 ? (
          <>
            <span className="absolute right-[7px] top-[7px] size-2 rounded-full bg-rose-400" />
            <span className="absolute right-[7px] top-[7px] size-2 animate-ping rounded-full bg-rose-400/70" />
            <span className="absolute -right-1 -top-1 grid min-h-[17px] min-w-[17px] place-items-center rounded-full border border-[#0b1128] bg-rose-500 px-1 text-[9px] font-bold leading-none text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          </>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />

          <section className="fixed left-3 right-3 top-[76px] z-50 mx-auto flex max-h-[calc(100dvh-6rem)] w-auto max-w-[390px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101832]/95 shadow-[0_24px_80px_rgba(0,0,0,.5)] backdrop-blur-2xl sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+12px)] sm:mx-0 sm:max-h-[min(70vh,480px)] sm:w-[min(92vw,390px)]">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-xl bg-violet/15 text-violet-200">
                  <BellRing className="size-4" />
                </span>
                <div>
                  <p className="font-display text-sm font-semibold text-white">
                    Notifications
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {unreadCount
                      ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"}`
                      : "You're all caught up"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={markAllRead}
                    title="Mark all as read"
                    className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-cyan"
                  >
                    <CheckCheck className="size-4" />
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 sm:max-h-[min(65vh,480px)]">
              {isLoading ? (
                <p className="px-4 py-8 text-center text-xs text-slate-400">
                  Loading updates…
                </p>
              ) : null}

              {isError ? (
                <p className="px-4 py-8 text-center text-xs text-rose-300">
                  Could not load notifications. Please try again.
                </p>
              ) : null}

              {!isLoading && !isError && notifications.length === 0 ? (
                <div className="px-5 py-9 text-center">
                  <span className="mx-auto grid size-11 place-items-center rounded-2xl bg-white/5 text-slate-400">
                    <Bell className="size-5" />
                  </span>
                  <p className="mt-3 font-display text-sm font-semibold text-white">
                    Nothing new yet
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    New offers and store announcements will appear here.
                  </p>
                </div>
              ) : null}

              {notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void markRead(item)}
                  className={`group mb-1 flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-white/[.07] ${
                    item.isUnread ? "bg-cyan/[.055]" : ""
                  }`}
                >
                  <span
                    className={`mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl ${
                      item.type === "offer"
                        ? "bg-lime-300/10 text-lime-200"
                        : item.type === "announcement"
                          ? "bg-violet/15 text-violet-200"
                          : "bg-cyan/10 text-cyan"
                    }`}
                  >
                    <TypeIcon type={item.type} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-display text-xs font-semibold text-white">
                        {item.title}
                      </span>
                      {item.isUnread ? (
                        <span className="size-1.5 shrink-0 rounded-full bg-cyan" />
                      ) : null}
                    </span>

                    <span className="mt-1 block whitespace-normal text-[11px] leading-relaxed text-slate-300">
                      {item.message}
                    </span>

                    <span className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                      {timeLabel(item.created_at)}
                      {item.link_url ? (
                        <>
                          <span>·</span>
                          <ExternalLink className="size-3" />
                          Open
                        </>
                      ) : null}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="shrink-0 border-t border-white/10 px-4 py-2.5 text-center text-[10px] text-slate-500">
              Zexy Store · Updates for your account
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

