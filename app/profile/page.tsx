"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertBanner } from "@/components/ui/alert-banner";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { BusinessProfileForm } from "@/components/BusinessProfileForm";
import {
  profileApi,
  describeRequestError,
  UnauthenticatedError,
  type BusinessProfile,
} from "@/lib/api-client";

const PROFILE_AUTH_PATH = "/auth?next=%2Fprofile";

/**
 * Your business details, typed once.
 *
 * The product's structural gap was that invoice #12 cost exactly what invoice
 * #1 cost — the same company name, address, logo and bank details retyped every
 * time. This page is the memory. It seeds new invoices and touches no existing
 * one, which is the promise made at the bottom of the form and the reason it is
 * safe to edit at any time.
 */
export default function BusinessProfilePage() {
  const router = useRouter();

  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [exists, setExists] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [canRetryLoad, setCanRetryLoad] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const loadProfile = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError("");
      setCanRetryLoad(false);
      const response = await profileApi.get();
      setProfile(response.profile);
      setExists(response.exists);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        router.replace(
          error.reason === "verify-email"
            ? `${PROFILE_AUTH_PATH}&reason=verify-email`
            : PROFILE_AUTH_PATH
        );
        return;
      }
      const { message, canRetry } = describeRequestError(
        error,
        "Couldn't load your business profile."
      );
      setLoadError(message);
      setCanRetryLoad(canRetry);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const saveProfile = useCallback(
    async (next: BusinessProfile) => {
      setSaveError("");
      setNotice("");
      setIsSaving(true);
      try {
        const response = await profileApi.save(next);
        setProfile(response.profile);
        setExists(true);
        setNotice(response.message);
      } catch (error) {
        if (error instanceof UnauthenticatedError) {
          router.replace(PROFILE_AUTH_PATH);
          return;
        }
        const { message } = describeRequestError(
          error,
          "Couldn't save your business profile."
        );
        setSaveError(message);
      } finally {
        setIsSaving(false);
      }
    },
    [router]
  );

  return (
    <PageShell tone="app">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white sm:text-3xl">
            Business profile
          </h1>
          <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Fill this in once and every new invoice starts with your details
            already on it — your name and address, your logo, your GSTIN, your
            terms and your bank details. Nothing here is required, and nothing
            here changes an invoice you have already created.
          </p>
        </div>

        {loadError ? (
          <AlertBanner
            tone="error"
            onRetry={canRetryLoad ? () => void loadProfile() : undefined}
          >
            {loadError}
          </AlertBanner>
        ) : null}

        {notice ? <AlertBanner tone="success">{notice}</AlertBanner> : null}
        {saveError ? <AlertBanner tone="error">{saveError}</AlertBanner> : null}

        {!isLoading && profile && !exists && !notice ? (
          <AlertBanner tone="info">
            You haven&rsquo;t saved a profile yet. Once you do, head to{" "}
            <Link
              href="/create-invoice"
              className="font-medium underline underline-offset-2"
            >
              a new invoice
            </Link>{" "}
            and it will already be filled in.
          </AlertBanner>
        ) : null}

        {isLoading || !profile ? (
          <div className="space-y-4" aria-hidden="true">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <BusinessProfileForm
            // Remount when the server's version changes, so the form's local
            // draft is replaced by what was actually stored rather than drifting
            // from it (the server normalizes GSTIN, state and PAN on save).
            key={`${exists}:${profile.companyGstin}:${profile.supplierStateCode}`}
            initial={profile}
            isSaving={isSaving}
            onSave={(next) => void saveProfile(next)}
          />
        )}
      </div>
    </PageShell>
  );
}
