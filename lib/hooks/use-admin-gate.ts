"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  adminApi,
  ApiError,
  UnauthenticatedError,
  describeRequestError,
} from "@/lib/api-client";
import type { AdminMe } from "@/lib/admin-types";

export type GateStatus = "checking" | "authorized" | "forbidden" | "error";

/**
 * Client admin gate. Probes /api/admin/me once:
 *  - not signed in / unverified  → redirect to /auth (same as the dashboard)
 *  - signed in but not an admin  → "forbidden" (render NotAuthorized, do NOT
 *    bounce to /auth — they're logged in, just not authorized)
 *  - other failure               → "error" with retry copy
 */
export function useAdminGate() {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<GateStatus>("checking");
  const [admin, setAdmin] = useState<AdminMe | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const me = await adminApi.me();
        if (!active) return;
        setAdmin(me);
        setStatus("authorized");
      } catch (err) {
        if (!active) return;
        if (err instanceof UnauthenticatedError) {
          const next = encodeURIComponent(pathname || "/admin");
          const reason = err.reason === "verify-email" ? "&reason=verify-email" : "";
          router.replace(`/auth?next=${next}${reason}`);
          return;
        }
        if (err instanceof ApiError && err.status === 403) {
          setStatus("forbidden");
          return;
        }
        setError(
          describeRequestError(err, "Couldn't load the admin panel.").message
        );
        setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [router, pathname]);

  return { status, admin, error };
}
