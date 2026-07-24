import Link from "next/link";
import { LockClosedIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";

export function NotAuthorized() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-10">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <LockClosedIcon className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Admin access required
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600 dark:text-slate-400">
          Your account doesn&apos;t have permission to view the control room. If
          you believe this is a mistake, contact the account owner.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
