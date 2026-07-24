"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  DashboardIcon,
  PersonIcon,
  FileTextIcon,
  ActivityLogIcon,
  ReaderIcon,
  HamburgerMenuIcon,
  Cross1Icon,
  ArrowLeftIcon,
} from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { MicroLabel } from "@/components/ui/micro-label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useAdminGate } from "@/lib/hooks/use-admin-gate";
import { AdminProvider } from "@/components/admin/admin-context";
import { NotAuthorized } from "@/components/admin/not-authorized";
import type { AdminMe } from "@/lib/admin-types";

const NAV = [
  { href: "/admin", label: "Overview", icon: DashboardIcon, exact: true },
  { href: "/admin/users", label: "Users", icon: PersonIcon },
  { href: "/admin/invoices", label: "Invoices", icon: FileTextIcon },
  { href: "/admin/activity", label: "Activity", icon: ActivityLogIcon },
  { href: "/admin/logs", label: "Logs", icon: ReaderIcon },
] as const;

const isActive = (
  pathname: string,
  item: { href: string; exact?: boolean }
): boolean =>
  item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);

function NavList({
  pathname,
  reduce,
  onNavigate,
}: {
  pathname: string;
  reduce: boolean | null;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "text-slate-900 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            )}
          >
            {active ? (
              <motion.span
                layoutId="admin-nav-active"
                className="absolute inset-0 rounded-md bg-slate-900/[0.06] dark:bg-white/10"
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 380, damping: 32 }
                }
              />
            ) : null}
            <Icon className="relative z-10 h-4 w-4" />
            <span className="relative z-10">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AdminIdentity({ admin }: { admin: AdminMe | null }) {
  if (!admin) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-32" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={admin.avatar || "/default-user-avatar.svg"}
        alt=""
        className="h-9 w-9 rounded-full border border-slate-200 object-cover dark:border-slate-700"
      />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {admin.name || "Admin"}
        </p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {admin.email}
        </p>
      </div>
    </div>
  );
}

function SidebarInner({ admin, pathname, reduce, onNavigate }: {
  admin: AdminMe | null;
  pathname: string;
  reduce: boolean | null;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <MicroLabel variant="meta">Admin · Control Room</MicroLabel>
        <Badge variant="info">Admin</Badge>
      </div>
      <div className="mt-4">
        <AdminIdentity admin={admin} />
      </div>
      <div className="my-4 h-px w-full bg-slate-200 dark:bg-slate-800" />
      <NavList pathname={pathname} reduce={reduce} onNavigate={onNavigate} />
      <div className="mt-auto pt-6">
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to app
        </Link>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-6 pt-1">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg lg:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { status, admin, error } = useAdminGate();
  const pathname = usePathname() || "/admin";
  const reduce = useReducedMotion();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const activeLabel =
    NAV.find((item) => isActive(pathname, item))?.label ?? "Admin";

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-white px-4 py-8 sm:px-6 lg:px-10 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-7xl">
        {/* Mobile top strip */}
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <div>
            <MicroLabel variant="meta">Control Room</MicroLabel>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {activeLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open admin menu"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <HamburgerMenuIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="lg:grid lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <SidebarInner admin={admin} pathname={pathname} reduce={reduce} />
            </div>
          </aside>

          <div className="min-w-0">
            {status === "checking" ? <ShellSkeleton /> : null}
            {status === "forbidden" ? <NotAuthorized /> : null}
            {status === "error" ? (
              <div className="pt-2">
                <AlertBanner onRetry={() => window.location.reload()}>
                  {error}
                </AlertBanner>
              </div>
            ) : null}
            {status === "authorized" ? (
              <AdminProvider admin={admin}>{children}</AdminProvider>
            ) : null}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              className="absolute left-0 top-0 flex h-full w-72 max-w-[85%] flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
              initial={{ x: reduce ? 0 : "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: reduce ? 0 : "-100%" }}
              transition={{ type: "tween", duration: reduce ? 0 : 0.2 }}
            >
              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  <Cross1Icon className="h-4 w-4" />
                </button>
              </div>
              <SidebarInner
                admin={admin}
                pathname={pathname}
                reduce={reduce}
                onNavigate={() => setMobileOpen(false)}
              />
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
    </main>
  );
}
