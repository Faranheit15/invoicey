"use client";

import * as React from "react";
import { MagnifyingGlassIcon, Cross2Icon } from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

interface SearchInputProps {
  value: string;
  onDebouncedChange: (value: string) => void;
  placeholder?: string;
  delay?: number;
  className?: string;
  "aria-label"?: string;
}

/** Debounced search box: emits the trimmed query `delay` ms after typing stops. */
export function SearchInput({
  value,
  onDebouncedChange,
  placeholder = "Search…",
  delay = 300,
  className,
  ...props
}: SearchInputProps) {
  const [local, setLocal] = React.useState(value);
  const isFirst = React.useRef(true);

  // Keep in sync when the parent resets the value (e.g. "Clear filters").
  React.useEffect(() => {
    setLocal(value);
  }, [value]);

  React.useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const timer = setTimeout(() => onDebouncedChange(local), delay);
    return () => clearTimeout(timer);
    // onDebouncedChange intentionally omitted to keep the debounce stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay]);

  return (
    <div className={cn("relative", className)}>
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
      <input
        type="text"
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        placeholder={placeholder}
        aria-label={props["aria-label"] ?? placeholder}
        className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-9 text-base text-foreground outline-none transition-colors placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:text-sm dark:placeholder:text-slate-500"
      />
      {local ? (
        <button
          type="button"
          onClick={() => setLocal("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
        >
          <Cross2Icon className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
