import type { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? (
        <div className="mb-3 text-slate-400 dark:text-slate-500">{icon}</div>
      ) : null}
      <p className="text-base font-medium text-slate-800 dark:text-slate-100">
        {title}
      </p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600 dark:text-slate-400">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
