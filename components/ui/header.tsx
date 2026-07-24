"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { requiresEmailVerification } from "@/lib/auth-client";
import { loadFirebaseAuth } from "@/lib/firebase-lazy";
import {
  DEFAULT_USER_AVATAR,
  normalizeAvatarUrl,
  sanitizeProviderId,
} from "@/lib/user-profile";
import UserSessionManager from "@/modules/UserSessionManager";
import { Button } from "@/components/ui/button";
import { MicroLabel } from "@/components/ui/micro-label";
import {
  THEME_STORAGE_KEY,
  Theme,
  applyTheme,
  resolveThemePreference,
} from "@/lib/theme";
import {
  Cross1Icon,
  HamburgerMenuIcon,
  MoonIcon,
  SunIcon,
} from "@radix-ui/react-icons";
import { InvoiceyMark } from "@/components/ui/invoicey-mark";

interface UserData {
  uid: string;
  email: string;
  name: string;
  photoURL: string;
  providerIds: string[];
  role?: "user" | "admin";
}

const fallbackAvatar = DEFAULT_USER_AVATAR;

const navLinks = [
  { href: "/about", label: "About" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
];

export default function Header() {
  const [user, setUser] = useState<UserData | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const router = useRouter();

  /**
   * Firebase Auth is loaded here rather than imported at module scope.
   *
   * This header lives in the root layout, so a static import put the whole
   * Auth SDK — 145 KB decoded, 43 KB over the wire — into the initial bundle of
   * *every* route, including four static marketing pages that never touch auth.
   * Importing it inside the effect moves it to a separate chunk fetched after
   * paint.
   *
   * No behavioural change: the header already rendered `user = null` until
   * onAuthStateChanged fired, so the signed-out shell was always the first
   * frame. This only shifts when the SDK arrives, not what is shown.
   */
  useEffect(() => {
    const userSessionManager = new UserSessionManager();
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { onAuthStateChanged, auth } = await loadFirebaseAuth();
      // The component may have unmounted while the chunk was in flight.
      if (cancelled) return;

      unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
        if (firebaseUser) {
          if (requiresEmailVerification(firebaseUser)) {
            userSessionManager.clearLocal();
            setUser(null);
            return;
          }

          const storedUser = userSessionManager.user;
          if (storedUser) {
            setUser(storedUser);
            return;
          }

          const normalizedUser: UserData = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || "",
            name: firebaseUser.displayName || "User",
            photoURL: normalizeAvatarUrl(firebaseUser.photoURL || fallbackAvatar),
            providerIds: Array.from(
              new Set(
                firebaseUser.providerData
                  .map((provider) => provider.providerId)
                  .map((providerId) => sanitizeProviderId(providerId))
                  .filter((providerId): providerId is string => Boolean(providerId))
              )
            ),
          };

          userSessionManager.user = normalizedUser;
          setUser(normalizedUser);
        } else {
          userSessionManager.clearLocal();
          setUser(null);
        }
      });
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const initialTheme = resolveThemePreference();
    applyTheme(initialTheme);
    setTheme(initialTheme);
  }, []);

  const logout = async () => {
    const userSessionManager = new UserSessionManager();
    // Already fetched by the effect above by the time this button can be
    // clicked; the import resolves from cache.
    const { signOut, auth } = await loadFirebaseAuth();
    await signOut(auth);
    userSessionManager.clearLocal();
    setUser(null);
    router.push("/auth");
  };

  const toggleTheme = () => {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur-md dark:border-slate-700 dark:bg-slate-950/85">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-10">
        <Link href="/" className="inline-flex min-w-0 items-center gap-2">
          <InvoiceyMark className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
              Invoicey
            </p>
            <MicroLabel variant="meta" className="truncate">
              Billing OS
            </MicroLabel>
          </div>
        </Link>

        <nav className="hidden items-center gap-5 text-sm text-slate-600 dark:text-slate-300 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-slate-900 dark:hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          {user ? (
            <Link href="/dashboard" className="hover:text-slate-900 dark:hover:text-white">
              Dashboard
            </Link>
          ) : null}
          {user ? (
            <Link href="/feedback" className="hover:text-slate-900 dark:hover:text-white">
              Feedback
            </Link>
          ) : null}
          {user?.role === "admin" ? (
            <Link href="/admin" className="hover:text-slate-900 dark:hover:text-white">
              Admin
            </Link>
          ) : null}
        </nav>

        <div className="hidden shrink-0 items-center gap-3 md:flex">
          <Button
            variant="outline"
            size="icon"
            type="button"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
            className="border-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            {theme === "dark" ? (
              <SunIcon className="w-4 h-4" />
            ) : (
              <MoonIcon className="w-4 h-4" />
            )}
          </Button>
          {user ? (
            <>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 text-left hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
              >
                <Image
                  src={user.photoURL || fallbackAvatar}
                  alt={user.name || "User avatar"}
                  width={28}
                  height={28}
                  className="h-7 w-7 rounded-full"
                />
                <span className="pr-2 text-sm text-slate-700 dark:text-slate-200">
                  {user.name}
                </span>
              </button>
              <Button variant="outline" onClick={logout}>
                Logout
              </Button>
            </>
          ) : (
            <Button asChild>
              <Link href="/auth">Get Started</Link>
            </Button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <SunIcon className="w-4 h-4" />
            ) : (
              <MoonIcon className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? (
              <Cross1Icon className="w-4 h-4" />
            ) : (
              <HamburgerMenuIcon className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="border-t border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-950 md:hidden">
          <nav className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-200">
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-md px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            </button>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Dashboard
                </Link>
                <Link
                  href="/feedback"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Feedback
                </Link>
                {user?.role === "admin" ? (
                  <Link
                    href="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="rounded-md px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Admin
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="rounded-md px-2 py-1 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Logout
                </button>
              </>
            ) : (
              <Button asChild onClick={() => setMobileMenuOpen(false)}>
                <Link href="/auth">Get Started</Link>
              </Button>
            )}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
