"use client";

import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { DotsHorizontalIcon, ReloadIcon } from "@radix-ui/react-icons";
import { adminApi, describeRequestError } from "@/lib/api-client";
import type { AdminInvoiceRow } from "@/lib/admin-types";

const STATUSES = ["draft", "sent", "paid", "overdue"] as const;

export function InvoiceAdminRowActions({
  invoice,
  onView,
  onChanged,
  onError,
}: {
  invoice: AdminInvoiceRow;
  onView: (invoice: AdminInvoiceRow) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const act = async (body: {
    action?: "soft_delete" | "restore";
    status?: string;
  }) => {
    try {
      setPending(true);
      await adminApi.invoiceAction(invoice._id, body);
      onChanged();
    } catch (error) {
      onError(describeRequestError(error, "That action failed.").message);
    } finally {
      setPending(false);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={pending}
            aria-label="Invoice actions"
          >
            {pending ? (
              <ReloadIcon className="h-4 w-4 animate-spin" />
            ) : (
              <DotsHorizontalIcon className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => onView(invoice)}>
            View invoice
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Set status</DropdownMenuLabel>
          {STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              disabled={invoice.status === status}
              className="capitalize"
              onSelect={() => act({ status })}
            >
              {status}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {invoice.is_deleted ? (
            <DropdownMenuItem onSelect={() => act({ action: "restore" })}>
              Restore invoice
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="text-rose-600 focus:text-rose-600 dark:text-rose-400"
              onSelect={(e) => {
                e.preventDefault();
                setConfirmDelete(true);
              }}
            >
              Soft-delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmDelete}
        title="Soft-delete this invoice?"
        description={
          <>
            <strong className="font-semibold text-slate-800 dark:text-slate-100">
              {invoice.invoiceNumber || "This invoice"}
            </strong>{" "}
            will be hidden from its owner and your lists. It is not erased — you
            can restore it from here.
          </>
        }
        confirmLabel="Soft-delete"
        isPending={pending}
        onConfirm={() => act({ action: "soft_delete" })}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
