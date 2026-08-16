"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertBanner } from "@/components/ui/alert-banner";
import { PageShell } from "@/components/ui/page-shell";
import { AccountDangerZone } from "@/components/AccountDangerZone";
import { downloadBlobObject } from "@/lib/download";
import {
  accountApi,
  describeRequestError,
  UnauthenticatedError,
  type AccountSummary,
} from "@/lib/api-client";

const ACCOUNT_AUTH_PATH = "/auth?next=%2Faccount";

/**
 * Your data, and the door out.
 *
 * The order on this page is the argument: export first, delete second. Someone
 * who came here to leave should have to walk past the file that lets them leave
 * with their records intact, and someone who came here for the file should
 * never trip over the delete button on the way.
 */
export default function AccountPage() {
  const router = useRouter();

  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [canRetryLoad, setCanRetryLoad] = useState(false);
  const [exportError, setExportError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportingFormat, setExportingFormat] = useState<"json" | "csv" | null>(
    null
  );
  const [hasExported, setHasExported] = useState(false);

  const loadSummary = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError("");
      setCanRetryLoad(false);
      setSummary(await accountApi.summary());
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        router.replace(
          error.reason === "verify-email"
            ? `${ACCOUNT_AUTH_PATH}&reason=verify-email`
            : ACCOUNT_AUTH_PATH
        );
        return;
      }
      const { message, canRetry } = describeRequestError(
        error,
        "Couldn't load your account."
      );
      setLoadError(message);
      setCanRetryLoad(canRetry);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const runExport = useCallback(
    async (format: "json" | "csv") => {
      setExportError("");
      setNotice("");
      setExportingFormat(format);
      try {
        const { blob, filename } = await accountApi.exportData(format);
        downloadBlobObject(filename, blob);
        setHasExported(true);
        setNotice(`Downloaded ${filename}.`);
      } catch (error) {
        if (error instanceof UnauthenticatedError) {
          router.replace(ACCOUNT_AUTH_PATH);
          return;
        }
        const { message } = describeRequestError(
          error,
          "Couldn't build your export."
        );
        setExportError(message);
      } finally {
        setExportingFormat(null);
      }
    },
    [router]
  );

  return (
    <PageShell tone="app">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white sm:text-3xl">
            Your account
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Take a copy of everything Invoicey holds on you, or close the
            account for good.
          </p>
        </div>

        {loadError ? (
          <AlertBanner
            tone="error"
            onRetry={canRetryLoad ? () => void loadSummary() : undefined}
          >
            {loadError}
          </AlertBanner>
        ) : null}

        {notice ? <AlertBanner tone="success">{notice}</AlertBanner> : null}
        {exportError ? <AlertBanner tone="error">{exportError}</AlertBanner> : null}

        <Card className="border-slate-200 bg-white/85 backdrop-blur dark:border-white/10 dark:bg-slate-900/75">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-slate-900 dark:text-white">
              Export your data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="max-w-[68ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Your data is yours, in a file you can read: your profile, every
              invoice you have created — including the ones you deleted — any
              feedback you sent, and your account activity. No special software
              to open it, no lock-in to get it. The activity list is a summary
              rather than the raw technical logs, and very large accounts are
              capped; if you need the rest, ask and we will send it.
            </p>
            <p className="max-w-[68ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              JSON is the complete record. CSV is a flat invoice list for
              spreadsheets, so it carries the invoices and nothing else.
            </p>
            {summary ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {summary.counts.invoices}{" "}
                {summary.counts.invoices === 1 ? "invoice" : "invoices"}
                {summary.counts.deletedInvoices > 0
                  ? ` (${summary.counts.deletedInvoices} deleted)`
                  : ""}
                , {summary.counts.feedback} feedback,{" "}
                {summary.counts.activity} activity entries.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void runExport("json")}
                disabled={exportingFormat !== null}
              >
                {exportingFormat === "json" ? "Preparing…" : "Download JSON"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void runExport("csv")}
                disabled={exportingFormat !== null}
              >
                {exportingFormat === "csv" ? "Preparing…" : "Download CSV"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading your account…
          </p>
        ) : (
          <AccountDangerZone
            summary={summary}
            hasExported={hasExported}
            isExporting={exportingFormat !== null}
            onExport={() => runExport("json")}
          />
        )}
      </div>
    </PageShell>
  );
}
