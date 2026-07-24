"use client";

import { useEffect } from "react";
import { AlertBanner } from "@/components/ui/alert-banner";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin route error:", error);
  }, [error]);

  return (
    <div className="py-10">
      <AlertBanner onRetry={reset}>
        Something went wrong loading this page. Try again in a moment.
      </AlertBanner>
    </div>
  );
}
