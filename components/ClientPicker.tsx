"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalCloseButton } from "@/components/ui/modal";
import { AlertBanner } from "@/components/ui/alert-banner";
import { MicroLabel } from "@/components/ui/micro-label";
import { SearchInput } from "@/components/ui/search-input";
import {
  clientsApi,
  describeRequestError,
  UnauthenticatedError,
} from "@/lib/api-client";
import type { ClientSummary } from "@/lib/clients";
import { formatDateLong } from "@/lib/format-date";
import { PersonIcon, ReloadIcon } from "@radix-ui/react-icons";

/**
 * "Use a saved client" — the client half of the product's memory.
 *
 * The list is DERIVED from the user's own invoices (see `lib/clients.ts`), so
 * there is nothing to set up: a user who has sent one invoice already has one
 * client in here, and the picker is empty only for someone who has never sent
 * anything.
 *
 * It deliberately does not apply anything itself. `onSelect` hands the chosen
 * client back to the editor, which owns the question of what to do about fields
 * the user has already typed — see `InvoiceEditor.chooseClient`.
 */

interface ClientPickerProps {
  onSelect: (client: ClientSummary) => void;
  disabled?: boolean;
}

export default function ClientPicker({ onSelect, disabled }: ClientPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const titleId = useId();

  const load = useCallback(async (query: string) => {
    setIsLoading(true);
    setError("");
    setCanRetry(false);
    try {
      const data = await clientsApi.list({ q: query || undefined });
      setClients(data.clients);
      setTruncated(data.truncated);
      setHasMore(data.hasMore);
    } catch (err) {
      setClients([]);
      if (err instanceof UnauthenticatedError) {
        // Deliberately not a redirect: this dialog sits on top of a form full
        // of unsaved work, and navigating away from it would destroy that.
        setError("Your session expired. Save is going to need you signed in again.");
        return;
      }
      const described = describeRequestError(err, "Couldn't load your clients.");
      setError(described.message);
      setCanRetry(described.canRetry);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    void load(search);
  }, [load, open, search]);

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <PersonIcon className="h-4 w-4" />
        Use a saved client
      </Button>

      {open ? (
        <Modal open onClose={close} labelledBy={titleId} className="max-w-lg">
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
              <div className="min-w-0">
                <MicroLabel as="p" variant="section">
                  Client
                </MicroLabel>
                <h2
                  id={titleId}
                  className="text-lg font-semibold text-slate-900 dark:text-slate-100"
                >
                  Saved clients
                </h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Everyone you have invoiced before. Picking one fills the client
                  fields; nothing you have already typed is replaced without
                  asking.
                </p>
              </div>
              <ModalCloseButton onClose={close} />
            </div>

            <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
              <SearchInput
                value={search}
                onDebouncedChange={setSearch}
                placeholder="Search by name, email or GSTIN"
                aria-label="Search saved clients"
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {error ? (
                <div className="p-4">
                  <AlertBanner onRetry={canRetry ? () => void load(search) : undefined}>
                    {error}
                  </AlertBanner>
                </div>
              ) : null}

              {isLoading ? (
                <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-600 dark:text-slate-300">
                  <ReloadIcon className="h-4 w-4 animate-spin" />
                  Loading clients…
                </div>
              ) : clients.length ? (
                <ul>
                  {clients.map((client) => (
                    <li
                      key={client.key}
                      className="border-b border-slate-200 last:border-b-0 dark:border-slate-700"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(client);
                          close();
                        }}
                        className="flex min-h-[44px] w-full flex-col items-start gap-0.5 px-5 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800"
                      >
                        <span className="w-full truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {client.name || "Unnamed client"}
                        </span>
                        {client.email || client.gstin ? (
                          <span className="w-full truncate text-xs text-slate-600 dark:text-slate-300">
                            {[client.email, client.gstin]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                        <span className="tabular text-xs text-slate-500 dark:text-slate-400">
                          {client.invoiceCount}{" "}
                          {client.invoiceCount === 1 ? "invoice" : "invoices"}
                          {client.lastInvoiceDate
                            ? ` · last ${formatDateLong(client.lastInvoiceDate)}`
                            : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : error ? null : (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {search ? "No client matches that." : "No saved clients yet"}
                  </p>
                  <p className="mx-auto mt-1 max-w-xs text-sm text-slate-600 dark:text-slate-300">
                    {search
                      ? "Try part of the name, the email address, or the GSTIN."
                      : "Send your first invoice and the client will appear here next time."}
                  </p>
                </div>
              )}
            </div>

            {truncated || hasMore ? (
              <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {hasMore
                  ? "Showing the most recent clients. Search to narrow it down."
                  : "Only your most recent invoices were searched, so a client you have not billed in a long time may be missing."}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
