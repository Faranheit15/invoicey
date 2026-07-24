"use client";

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ChevronDownIcon,
  CopyIcon,
  CheckIcon,
} from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { MicroLabel } from "@/components/ui/micro-label";
import { useCopy } from "@/lib/hooks/use-copy";
import { LOG_LEVEL_DOT, LOG_CATEGORY_LABEL } from "@/lib/logs";
import type { LogEntry } from "@/lib/logs";

const formatTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-md bg-slate-100 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function LogDetail({ log }: { log: LogEntry }) {
  const meta = log.meta;
  if (!meta) {
    return <p className="text-xs text-slate-400">No additional details.</p>;
  }

  const prompt = typeof meta.fullPrompt === "string" ? meta.fullPrompt : null;
  const stack = typeof meta.stack === "string" ? meta.stack : null;

  return (
    <div className="space-y-3">
      {log.userId ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          User: <span className="tabular">{log.userId}</span>
        </p>
      ) : null}

      {prompt ? (
        <div>
          <MicroLabel variant="meta">Prompt</MicroLabel>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
            {prompt}
          </pre>
        </div>
      ) : null}

      {stack ? (
        <div>
          <MicroLabel variant="meta">Stack</MicroLabel>
          <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100 dark:bg-slate-950">
            {stack}
          </pre>
        </div>
      ) : null}

      <div>
        <MicroLabel variant="meta">Metadata</MicroLabel>
        <div className="mt-1">
          <JsonBlock value={meta} />
        </div>
      </div>
    </div>
  );
}

export function LogRow({ log, isNew }: { log: LogEntry; isNew?: boolean }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const { copied, copy } = useCopy();

  return (
    <li
      className={cn(
        "border-b border-slate-100 last:border-b-0 dark:border-slate-800",
        log.level === "error" && "border-l-2 border-l-rose-400 dark:border-l-rose-500/70",
        isNew && !reduce && "animate-in fade-in slide-in-from-top-1"
      )}
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 44px" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", LOG_LEVEL_DOT[log.level])}
        />
        <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
          {LOG_CATEGORY_LABEL[log.category]}
        </Badge>
        <span className="tabular hidden shrink-0 text-xs text-slate-400 dark:text-slate-500 md:inline">
          {formatTime(log.at)}
        </span>
        <span className="shrink-0 font-medium text-slate-700 dark:text-slate-200">
          {log.event}
        </span>
        <span className="min-w-0 flex-1 truncate text-slate-500 dark:text-slate-400">
          {log.message}
        </span>
        <ChevronDownIcon
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1">
              <LogDetail log={log} />
              <button
                type="button"
                onClick={() => copy(JSON.stringify(log.meta ?? {}, null, 2))}
                className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {copied ? (
                  <CheckIcon className="h-3.5 w-3.5" />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy JSON"}
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  );
}
