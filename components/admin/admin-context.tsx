"use client";

import { createContext, useContext } from "react";
import type { AdminMe } from "@/lib/admin-types";

const AdminContext = createContext<AdminMe | null>(null);

export function AdminProvider({
  admin,
  children,
}: {
  admin: AdminMe | null;
  children: React.ReactNode;
}) {
  return <AdminContext.Provider value={admin}>{children}</AdminContext.Provider>;
}

/** The current admin identity, shared so pages/sidebar don't refetch it. */
export function useAdmin(): AdminMe | null {
  return useContext(AdminContext);
}
