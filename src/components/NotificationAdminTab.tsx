import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, Megaphone, Pencil, RefreshCw, Send, Settings2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  deleteAdminNotification,
  getAdminNotificationData,
  saveAdminNotification,
  saveWelcomeSettings,
} from "@/lib/notifications.functions";

type NotificationRow = {
  id: string;
  title: string;
  message: string;
  type: "offer" | "announcement" | "update";
  link_url: string | null;
  is_active: boolean;
  created_at: string;
};

type WelcomeForm = {
  isEnabled: boolean;
  title: string;
  subtitle: string;
  communityUrl: string;
  communityLabel: string;
};

const inputClass = "glass-panel w-full rounded-xl px-3 py-2.5 text-sm outline-none placeholder:text-faint focus:border-violet/50";
const primaryClass = "brand-gradient inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 font-display text-xs font-semibold text-ink transition hover:brightness-110 disabled:opacity-50";
const secondaryClass = "glass-panel inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition hover:border-violet/30";
const emptyWelcome: WelcomeForm = {
  isEnabled: true,
  title: "Welcome to Zeoxy Store",
  subtitle: "Your game top-ups, store offers and important updates — all in one place.",
  communityUrl: "",
  communityLabel: "Join our community",
};

export function NotificationAdminTab() {
  const getData = useServerFn(getAdminNotificationData);
  const saveNotification = useServerFn(saveAdminNotification);
  const deleteNotification = useServerFn(deleteAdminNotification);
  const saveWelcome = useServerFn(saveWelcomeSettings);

  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [welcome, setWelcome] = useState<WelcomeForm>(emptyWelcome);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [type, setType] = useState<"offer" | "announcement" | "update">("announcement");
  const [linkUrl, setLinkUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingNotification, setSavingNotification] = useState(false);
  const [savingWelcome, setSavingWelcome] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getData();
      setRows(result.notifications as NotificationRow[]);
      setWelcome({
        isEnabled: result.welcomeSettings.is_enabled,
        title: result.welcomeSettings.title,
        subtitle: result.welcomeSettings.subtitle,
        communityUrl: result.welcomeSettings.community_url ?? "",
        communityLabel: result.welcomeSettings.community_label,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load notification settings");
    } finally {
      setLoading(false);
    }
  }, [getData]);

  useEffect(() => { void refresh(); }, [refresh]);

  function resetNotificationForm() {
    setEditingId(null);
    setTitle("");
    setMessage("");
    setType("announcement");
    setLinkUrl("");
    setIsActive(true);
  }

  function editRow(row: NotificationRow) {
    setEditingId(row.id);
    setTitle(row.title);
    setMessage(row.message);
    setType(row.type);
    setLinkUrl(row.link_url ?? "");
    setIsActive(row.is_active);
    document.getElementById("zeoxy-notification-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingNotification(true);
    try {
      await saveNotification({
        data: {
          ...(editingId ? { id: editingId } : {}),
          title,
          message,
          type,
          linkUrl: linkUrl.trim() || null,
          isActive,
        },
      });
      toast.success(editingId ? "Notification updated" : "Notification published");
      resetNotificationForm();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save notification");
    } finally {
      setSavingNotification(false);
    }
  }

  async function toggleRow(row: NotificationRow) {
    try {
      await saveNotification({ data: {
        id: row.id,
        title: row.title,
        message: row.message,
        type: row.type,
        linkUrl: row.link_url,
        isActive: !row.is_active,
      } });
      toast.success(row.is_active ? "Notification hidden from users" : "Notification is live");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update notification");
    }
  }

  async function removeRow(row: NotificationRow) {
    if (!window.confirm(`Delete “${row.title}”? This cannot be undone.`)) return;
    try {
      await deleteNotification({ data: { id: row.id } });
      toast.success("Notification deleted");
      if (editingId === row.id) resetNotificationForm();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete notification");
    }
  }

  async function submitWelcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingWelcome(true);
    try {
      await saveWelcome({ data: {
        ...welcome,
        communityUrl: welcome.communityUrl.trim() || null,
      } });
      toast.success("Welcome popup settings saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save welcome popup settings");
    } finally {
      setSavingWelcome(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet/15 text-violet-200"><Settings2 className="size-5" /></span>
          <div>
            <h2 className="font-display text-sm font-semibold">First-visit welcome popup</h2>
            <p className="mt-1 text-xs leading-relaxed text-faint">Shown once per browser to guests and signed-in users. The active coupon is picked automatically from your Coupons list; exhausted or deactivated coupons are not displayed.</p>
          </div>
        </div>
        <form onSubmit={submitWelcome} className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={welcome.isEnabled} onChange={(event) => setWelcome((old) => ({ ...old, isEnabled: event.target.checked }))} className="size-4 accent-violet" /> Enable welcome popup</label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Headline</span><input required maxLength={90} value={welcome.title} onChange={(event) => setWelcome((old) => ({ ...old, title: event.target.value }))} className={inputClass} /></label>
            <label className="sm:col-span-2"><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Supporting message</span><textarea required maxLength={240} rows={2} value={welcome.subtitle} onChange={(event) => setWelcome((old) => ({ ...old, subtitle: event.target.value }))} className={inputClass} /></label>
            <label><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Community / channel URL</span><input type="text" placeholder="https://discord.gg/... or /community" value={welcome.communityUrl} onChange={(event) => setWelcome((old) => ({ ...old, communityUrl: event.target.value }))} className={inputClass} /></label>
            <label><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Community button label</span><input maxLength={40} value={welcome.communityLabel} onChange={(event) => setWelcome((old) => ({ ...old, communityLabel: event.target.value }))} className={inputClass} /></label>
          </div>
          <button type="submit" disabled={savingWelcome} className={primaryClass}>{savingWelcome ? "Saving…" : "Save welcome settings"}</button>
        </form>
      </section>

      <section id="zeoxy-notification-form" className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan/10 text-cyan"><Send className="size-5" /></span>
          <div>
            <h2 className="font-display text-sm font-semibold">Send a notification</h2>
            <p className="mt-1 text-xs leading-relaxed text-faint">Published notifications appear in the bell for signed-in users. Each user has an independent read/unread state.</p>
          </div>
        </div>
        <form onSubmit={submitNotification} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Notification title</span><input required minLength={3} maxLength={90} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="New coupon is live!" className={inputClass} /></label>
            <label><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Type</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)} className={inputClass}><option value="announcement">Announcement</option><option value="offer">Offer</option><option value="update">Store update</option></select></label>
            <label className="sm:col-span-2"><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Message</span><textarea required minLength={3} maxLength={500} rows={3} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tell customers what is new…" className={inputClass} /></label>
            <label className="sm:col-span-2"><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Optional link (website path or https URL)</span><input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="/topup/mobile-legends or https://..." className={inputClass} /></label>
          </div>
          <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} className="size-4 accent-violet" /> Publish immediately</label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={savingNotification} className={primaryClass}>{savingNotification ? "Saving…" : <><Send className="size-3.5" /> {editingId ? "Update notification" : "Publish notification"}</>}</button>
            {editingId ? <button type="button" onClick={resetNotificationForm} className={secondaryClass}><X className="size-3.5" /> Cancel edit</button> : null}
          </div>
        </form>
      </section>

      <section className="glass-panel rounded-2xl p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Megaphone className="size-4 text-violet-200" /><h2 className="font-display text-sm font-semibold">Notification history</h2></div>
          <button type="button" onClick={() => void refresh()} className={secondaryClass}><RefreshCw className="size-3.5" /> Refresh</button>
        </div>
        {loading ? <p className="py-8 text-center text-xs text-faint">Loading notifications…</p> : rows.length === 0 ? <p className="py-8 text-center text-xs text-faint">No notifications created yet.</p> : (
          <div className="mt-3 space-y-2">
            {rows.map((row) => (
              <article key={row.id} className="rounded-xl border border-white/10 bg-white/[.025] p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-sm font-semibold">{row.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${row.is_active ? "bg-lime/10 text-lime-200" : "bg-white/10 text-slate-400"}`}>{row.is_active ? "Live" : "Hidden"}</span>
                      <span className="rounded-full bg-violet/10 px-2 py-0.5 text-[9px] uppercase text-violet-200">{row.type}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{row.message}</p>
                    {row.link_url ? <p className="mt-2 flex items-center gap-1 break-all text-[10px] text-cyan"><ExternalLink className="size-3 shrink-0" />{row.link_url}</p> : null}
                    <p className="mt-2 text-[10px] text-slate-500">Created {new Date(row.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button type="button" onClick={() => editRow(row)} title="Edit" className={secondaryClass}><Pencil className="size-3.5" /> Edit</button>
                    <button type="button" onClick={() => void toggleRow(row)} className={secondaryClass}>{row.is_active ? "Deactivate" : "Activate"}</button>
                    <button type="button" onClick={() => void removeRow(row)} title="Delete" className="glass-panel inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-rose-300 hover:border-rose-400/30"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
