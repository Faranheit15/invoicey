"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { LogViewer } from "@/components/admin/logs/log-viewer";

function LogsContent() {
  const sp = useSearchParams();
  const initialFilters = {
    level: sp.get("level") || undefined,
    category: sp.get("category") || undefined,
    userId: sp.get("userId") || undefined,
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow="Logs"
        title="Application logs"
        subtitle="Every user action, AI prompt, report, and error — searchable, filterable, live."
      />
      <LogViewer
        key={`${initialFilters.level}|${initialFilters.category}|${initialFilters.userId}`}
        initialFilters={initialFilters}
      />
    </div>
  );
}

export default function AdminLogsPage() {
  return (
    <Suspense
      fallback={<AdminPageHeader eyebrow="Logs" title="Application logs" />}
    >
      <LogsContent />
    </Suspense>
  );
}
