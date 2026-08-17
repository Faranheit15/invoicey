"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { loadFirebaseAuth } from "@/lib/firebase-lazy";
import { getProviderIdsFromFirebaseUser } from "@/lib/auth-client";
import {
  accountApi,
  describeRequestError,
  UnauthenticatedError,
  type AccountSummary,
} from "@/lib/api-client";
import UserSessionManager from "@/modules/UserSessionManager";

/**
 * The irreversible half of the account page, extracted so the gate logic is one
 * readable unit rather than another branch inside a page component.
 *
 * FOUR GATES, ALL REQUIRED, IN ORDER. Each one stops a different mistake:
 *  1. Real counts, not a generic warning — a specific number is what makes
 *     someone stop and think "wait, 47 invoices".
 *  2. The export gate, which the user cannot walk past without either taking
 *     their file or explicitly declining it. This is also where the GST
 *     retention duty gets said out loud: it is the USER's duty, not Invoicey's,
 *     and leaving empty-handed is the real harm here.
 *  3. Typing your own email address, not the word DELETE — it forces you to
 *     read WHICH account this is.
 *  4. Re-authentication, so a session someone else picked up cannot do this.
 *
 * Gates 3 and 4 are re-checked on the server (app/api/account/route.ts). What
 * is in this file guards the button; the server guards the account.
 */

interface AccountDangerZoneProps {
  summary: AccountSummary | null;
  /** True once the user has downloaded an export in this session. */
  hasExported: boolean;
  /** Runs the page's export handler so the in-dialog button reuses one path. */
  onExport: () => Promise<void>;
  isExporting: boolean;
}

export function AccountDangerZone({
  summary,
  hasExported,
  onExport,
  isExporting,
}: AccountDangerZoneProps) {
  const [open, setOpen] = useState(false);
  const [skippedExport, setSkippedExport] = useState(false);
  const [dataAcknowledged, setDataAcknowledged] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState("");

  const email = summary?.email ?? "";
  const counts = summary?.counts;

  // Reset every gate when the dialog closes so a reopened dialog never starts
  // half-consented from a previous visit.
  useEffect(() => {
    if (open) return;
    setSkippedExport(false);
    setDataAcknowledged(false);
    setTypedEmail("");
    setPassword("");
    setNeedsPassword(false);
    setError("");
  }, [open]);

  const exportSettled = hasExported || skippedExport;
  const emailMatches =
    typedEmail.trim().toLowerCase() === email.trim().toLowerCase() &&
    email.length > 0;
  const canDelete = exportSettled && dataAcknowledged && emailMatches && !isDeleting;

  /**
   * Prove identity again, right now. `getIdToken(true)` afterwards is not
   * optional: the server reads `auth_time` off the ID token, and a cached token
   * still carries the OLD sign-in time no matter how recently the user
   * re-authenticated.
   */
  const reauthenticate = useCallback(async (): Promise<boolean> => {
    const { auth } = await loadFirebaseAuth();
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) throw new UnauthenticatedError("signed-out");

    const providers = getProviderIdsFromFirebaseUser(user);
    const {
      EmailAuthProvider,
      GoogleAuthProvider,
      reauthenticateWithCredential,
      reauthenticateWithPopup,
    } = await import("firebase/auth");

    if (providers.includes("password")) {
      if (!password) {
        setNeedsPassword(true);
        setError("Enter your password to confirm this is you.");
        return false;
      }
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email ?? email, password)
      );
    } else {
      await reauthenticateWithPopup(user, new GoogleAuthProvider());
    }

    await user.getIdToken(true);
    return true;
  }, [email, password]);

  const confirmDelete = async () => {
    setError("");
    setIsDeleting(true);
    try {
      const reauthed = await reauthenticate();
      if (!reauthed) return;

      await accountApi.deleteAccount(typedEmail.trim());

      // Only now is there nothing to come back to. Clear the local session
      // before leaving so a stale cookie cannot bounce them into a signed-in
      // shell for an account that no longer exists.
      const { auth, signOut } = await loadFirebaseAuth();
      new UserSessionManager().clearLocal();
      await signOut(auth).catch(() => {});
      // A hard navigation, not router.push: every client cache, in-memory
      // store, and mounted component belonging to that account should go.
      window.location.replace("/?account=deleted");
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setNeedsPassword(true);
        setError("That password didn't match. Try again.");
      } else if (code === "auth/popup-closed-by-user") {
        setError("Sign-in was cancelled. Nothing has been deleted.");
      } else if (err instanceof UnauthenticatedError) {
        setError("Your session ended. Sign in again to delete your account.");
      } else {
        const { message } = describeRequestError(
          err,
          "Account deletion did not complete. Nothing has been lost — try again."
        );
        setError(message);
      }
    } finally {
      setIsDeleting(false);
    }
  };

  const damage = counts
    ? `${counts.invoices} ${counts.invoices === 1 ? "invoice" : "invoices"}${
        counts.deletedInvoices > 0
          ? ` (${counts.deletedInvoices} of them already in the recycle bin)`
          : ""
      }, ${counts.feedback} ${counts.feedback === 1 ? "note" : "notes"} of feedback, and your account`
    : "your invoices, your feedback, and your account";

  return (
    <>
      <Card className="border-rose-200 bg-white/85 backdrop-blur dark:border-rose-400/30 dark:bg-slate-900/75">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg text-rose-700 dark:text-rose-300">
            <ExclamationTriangleIcon className="h-4 w-4" />
            Delete your account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-[68ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            This deletes your account, every invoice you have ever created here
            — including the ones you already deleted — your saved business
            details (GSTIN, PAN, address, bank account, IFSC, UPI ID and
            signature) and your feedback. It is permanent. There is no recycle
            bin for this, no grace period, and no way for us to bring any of it
            back.
          </p>
          <p className="max-w-[68ch] text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Download your data first. It takes one click and it is the only copy
            you will get.
          </p>
          <Button
            type="button"
            variant="destructive"
            onClick={() => setOpen(true)}
          >
            Delete my account
          </Button>
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={isDeleting ? () => {} : () => setOpen(false)}
        labelledBy="delete-account-title"
        dismissOnBackdrop={false}
        className="max-w-lg"
      >
        <div className="max-h-[85vh] overflow-y-auto p-6">
          <h2
            id="delete-account-title"
            className="text-lg font-semibold text-slate-900 dark:text-slate-100"
          >
            Permanently delete your account
          </h2>

          {/* Gate 1 — the damage, in real numbers. */}
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            This will permanently delete {damage}. This cannot be undone.
          </p>

          {/* Gate 2 — the export, which the flow will not let them walk past. */}
          <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Take your data first
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              If you are registered under GST you are required to keep your
              invoice records for 72 months. Invoicey is not your books of
              account — take the file.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={() => void onExport()}
                disabled={isExporting || isDeleting}
              >
                {isExporting ? "Preparing…" : "Download my data first"}
              </Button>
              {!exportSettled ? (
                <button
                  type="button"
                  onClick={() => setSkippedExport(true)}
                  className="text-sm text-slate-500 underline underline-offset-4 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Skip this
                </button>
              ) : null}
            </div>
            <label
              className={`mt-3 flex items-start gap-2 text-sm ${
                exportSettled
                  ? "text-slate-700 dark:text-slate-200"
                  : "cursor-not-allowed text-slate-400 dark:text-slate-500"
              }`}
            >
              <input
                type="checkbox"
                checked={dataAcknowledged}
                disabled={!exportSettled || isDeleting}
                onChange={(event) => setDataAcknowledged(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-600"
              />
              <span>I have my data, or I don&apos;t want it.</span>
            </label>
          </div>

          {/* Gate 3 — type the address of the account being destroyed. */}
          <div className="mt-5">
            <label
              htmlFor="confirm-email"
              className="block text-sm font-medium text-slate-900 dark:text-slate-100"
            >
              Type <span className="font-mono">{email}</span> to confirm
            </label>
            <Input
              id="confirm-email"
              type="email"
              autoComplete="off"
              spellCheck={false}
              value={typedEmail}
              disabled={isDeleting}
              onChange={(event) => setTypedEmail(event.target.value)}
              className="mt-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              placeholder="your email address"
            />
          </div>

          {/* Gate 4 — the credential itself, for password accounts. Google
              accounts get a popup instead, triggered by the final button. */}
          {needsPassword ? (
            <div className="mt-4">
              <label
                htmlFor="confirm-password"
                className="block text-sm font-medium text-slate-900 dark:text-slate-100"
              >
                Your password
              </label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={isDeleting}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          ) : null}

          {error ? (
            <AlertBanner tone="error" className="mt-4">
              {error}
            </AlertBanner>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={isDeleting}
              onClick={() => setOpen(false)}
            >
              Keep my account
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!canDelete}
              onClick={confirmDelete}
            >
              {isDeleting ? "Deleting…" : "Permanently delete my account"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
