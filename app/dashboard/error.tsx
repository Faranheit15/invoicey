"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard render error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 text-center">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
        Something went wrong loading your dashboard
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        A single invoice may have unexpected data. You can retry, and if it keeps
        happening, refresh the page.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
