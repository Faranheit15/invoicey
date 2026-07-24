"use client";

import { cn } from "@/lib/utils";
import { SelectField } from "@/components/ui/select-field";
import { SearchInput } from "@/components/ui/search-input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { LOG_LEVELS, LOG_CATEGORIES, LOG_CATEGORY_LABEL } from "@/lib/logs";
import type { LogFilters } from "@/lib/hooks/use-logs-query";

const CATEGORY_OPTIONS = [
  { value: "", label: "All categories" },
  ...LOG_CATEGORIES.map((c) => ({ value: c, label: LOG_CATEGORY_LABEL[c] })),
];
const LEVELS = ["", ...LOG_LEVELS];

export function LogFilterBar({
  filters,
  onFilters,
  tailing,
  onToggleTail,
}: {
  filters: LogFilters;
  onFilters: (filters: LogFilters) => void;
  tailing: boolean;
  onToggleTail: () => void;
}) {
  const set = (patch: Partial<LogFilters>) => onFilters({ ...filters, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-md border border-slate-200 p-0.5 dark:border-slate-700">
        {LEVELS.map((level) => {
          const active = (filters.level || "") === level;
          return (
            <button
              key={level || "all"}
              type="button"
              onClick={() => set({ level: level || undefined })}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                active
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              )}
            >
              {level || "All"}
            </button>
          );
        })}
      </div>

      <SelectField
        value={filters.category || ""}
        onValueChange={(v) => set({ category: v || undefined })}
        options={CATEGORY_OPTIONS}
        className="w-auto min-w-[160px]"
      />

      <SearchInput
        value={filters.q || ""}
        onDebouncedChange={(v) => set({ q: v || undefined })}
        placeholder="Search message…"
        className="min-w-[200px] flex-1"
      />

      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
        <Switch checked={tailing} onCheckedChange={onToggleTail} />
        <span className="inline-flex items-center gap-1.5">
          {tailing ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          ) : null}
          Live
        </span>
      </label>

      <Button variant="ghost" size="sm" onClick={() => onFilters({})}>
        Clear
      </Button>
    </div>
  );
}
