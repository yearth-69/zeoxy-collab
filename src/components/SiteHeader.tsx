import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  LogIn,
  LogOut,
  Moon,
  Receipt,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/lib/theme";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { HamburgerButton } from "@/components/MobileMenu";
import { NotificationBell } from "@/components/NotificationBell";

export function SiteHeader({ onMenuClick }: { onMenuClick: () => void }) {
  const { theme, toggle } = useTheme();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;

    setSigningOut(true);
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      await supabase.auth.signOut();
      navigate({ to: "/auth", replace: true });
    } finally {
      setSigningOut(false);
    }
  }

  return (
      <header className="relative z-30 flex items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          {/* Original site logo and mobile menu */}
          <HamburgerButton onClick={onMenuClick} />

          <Link to="/" className="flex min-w-0 items-center gap-2" aria-label="ZEXY STORE home">
            <div className="size-9 shrink-0 overflow-hidden rounded-xl">
              <img
                src="/logo.jpeg"
                alt="ZEXY STORE"
                width={36}
                height={36}
                className="h-full w-full object-contain"
              />
            </div>

            <div className="min-w-0">
              <p className="truncate font-display text-base font-semibold leading-none tracking-tight">
                ZEXY STORE
              </p>
            </div>
          </Link>
        </div>

        <nav
          aria-label="Main navigation"
          className="flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-2"
        >
          {/* Desktop navigation */}
          <Link
            to="/how-it-works"
            className="glass-panel hidden items-center rounded-xl px-3 py-2 text-xs text-subtle lg:flex"
          >
            How It Works
          </Link>

          <Link
            to="/contact"
            className="glass-panel hidden items-center rounded-xl px-3 py-2 text-xs text-subtle md:flex"
          >
            Contact Us
          </Link>

          <Link
            to="/about"
            className="glass-panel hidden items-center rounded-xl px-3 py-2 text-xs text-subtle lg:flex"
          >
            About Us
          </Link>

          {user ? (
            <Link
              to="/orders"
              className="glass-panel hidden items-center gap-2 rounded-xl px-3 py-2 text-xs text-subtle sm:flex"
            >
              <Receipt className="size-4" />
              Orders
            </Link>
          ) : null}

          {isAdmin ? (
            <Link
              to="/admin"
              aria-label="Admin panel"
              className="glass-panel hidden items-center gap-2 rounded-xl px-3 py-2 text-cyan sm:flex"
            >
              <ShieldCheck className="size-4" />
              <span className="text-xs">Admin</span>
            </Link>
          ) : null}

          {user ? (
            <>
              <Link
                to="/profile"
                aria-label="Profile"
                title="Profile"
                className="glass-panel hidden items-center gap-2 rounded-xl px-3 py-2 text-xs text-subtle transition hover:border-violet/30 hover:text-white sm:flex"
              >
                <UserRound className="size-4" />
                Profile
              </Link>

              {/* Notification bell is available only to signed-in users */}
              <NotificationBell />

              <button
                type="button"
                onClick={signOut}
                disabled={signingOut}
                aria-label="Sign out"
                title={signingOut ? "Signing out…" : "Sign out"}
                className="glass-panel hidden size-10 place-items-center rounded-xl text-subtle transition hover:border-rose-400/30 hover:text-rose-200 disabled:opacity-50 sm:grid"
              >
                <LogOut className="size-4" />
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              aria-label="Sign in"
              title="Sign in"
              className="glass-panel flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs text-subtle sm:flex"
            >
              <LogIn className="size-4" />
              <span className="hidden text-xs sm:inline">Sign in</span>
            </Link>
          )}

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggle}
            aria-label="Toggle theme"
            title="Toggle theme"
            className="glass-panel grid size-10 shrink-0 place-items-center rounded-xl text-subtle"
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </button>
        </nav>
      </header>

  );
}

export function SiteFooter() {
  return (
    <footer className="relative z-10 mb-5 mt-10 border-t border-white/[.07] px-4 pt-4 text-center sm:px-6">
      <p className="text-[10px] tracking-wide text-slate-500">
        © {new Date().getFullYear()} ZEXY STORE · Game top-ups made simple.
      </p>
    </footer>
  );
}

