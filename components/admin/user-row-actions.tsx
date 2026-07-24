"use client";

import { useState } from "react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { DotsHorizontalIcon, ReloadIcon } from "@radix-ui/react-icons";
import { adminApi, describeRequestError } from "@/lib/api-client";
import type { UserAction } from "@/lib/api-client";
import type { AdminUserRow } from "@/lib/admin-types";

export function UserRowActions({
  user,
  currentUid,
  onDone,
  onError,
}: {
  user: AdminUserRow;
  currentUid?: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [pending, setPending] = useState<UserAction | null>(null);
  const [confirm, setConfirm] = useState<"suspend" | "revoke" | null>(null);
  const isSelf = currentUid === user.uid;

  const run = async (action: UserAction) => {
    try {
      setPending(action);
      await adminApi.userAction(user.uid, action);
      onDone();
    } catch (error) {
      onError(describeRequestError(error, "That action failed.").message);
    } finally {
      setPending(null);
      setConfirm(null);
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
            disabled={pending !== null}
            aria-label="User actions"
          >
            {pending ? (
              <ReloadIcon className="h-4 w-4 animate-spin" />
            ) : (
              <DotsHorizontalIcon className="h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link href={`/admin/users/${user.uid}`}>View details</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {user.role === "admin" ? (
            <DropdownMenuItem
              disabled={isSelf}
              onSelect={(e) => {
                e.preventDefault();
                setConfirm("revoke");
              }}
            >
              Revoke admin
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => run("promote")}>
              Make admin
            </DropdownMenuItem>
          )}
          {user.status === "suspended" ? (
            <DropdownMenuItem onSelect={() => run("unsuspend")}>
              Reactivate account
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={isSelf}
              className="text-rose-600 focus:text-rose-600 dark:text-rose-400"
              onSelect={(e) => {
                e.preventDefault();
                setConfirm("suspend");
              }}
            >
              Suspend account
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "suspend"}
        title="Suspend this user?"
        description={
          <>
            <strong className="font-semibold text-slate-800 dark:text-slate-100">
              {user.email}
            </strong>{" "}
            will be signed out everywhere and blocked from the app until you
            reactivate them. Their invoices are kept.
          </>
        }
        confirmLabel="Suspend user"
        isPending={pending === "suspend"}
        onConfirm={() => run("suspend")}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        title="Revoke admin access?"
        description={
          <>
            <strong className="font-semibold text-slate-800 dark:text-slate-100">
              {user.email}
            </strong>{" "}
            will lose access to the control room. They keep their own account and
            invoices.
          </>
        }
        confirmLabel="Revoke admin"
        isPending={pending === "revoke"}
        onConfirm={() => run("revoke")}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
