"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { DownloadIcon, ReloadIcon } from "@radix-ui/react-icons";
import { downloadBlobObject } from "@/lib/download";
import { describeRequestError } from "@/lib/api-client";

export function ExportMenu({
  onExport,
  onError,
}: {
  onExport: (format: "csv" | "json") => Promise<{ blob: Blob; filename: string }>;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const run = async (format: "csv" | "json") => {
    try {
      setBusy(true);
      const { blob, filename } = await onExport(format);
      downloadBlobObject(filename, blob);
    } catch (error) {
      onError?.(describeRequestError(error, "Export failed.").message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? (
            <ReloadIcon className="h-4 w-4 animate-spin" />
          ) : (
            <DownloadIcon className="h-4 w-4" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run("csv")}>Export CSV</DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("json")}>
          Export JSON
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
