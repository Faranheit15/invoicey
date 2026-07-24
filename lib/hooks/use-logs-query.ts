"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, describeRequestError } from "@/lib/api-client";
import type { LogEntry } from "@/lib/logs";

export type LogFilters = {
  level?: string;
  category?: string;
  event?: string;
  userId?: string;
  q?: string;
  dateFrom?: string;
  dateTo?: string;
};

const PAGE = 50;
const RENDER_CAP = 500;
const POLL_MS = 4000;

/** Cursor-paginated, optionally live-tailing log stream state. */
export function useLogsQuery(initial: LogFilters = {}) {
  const [filters, setFiltersState] = useState<LogFilters>(initial);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const [tailing, setTailing] = useState(false);
  const newestRef = useRef<string | null>(null);

  const loadInitial = useCallback(async () => {
    try {
      setIsLoading(true);
      setError("");
      const res = await adminApi.logs({ ...filters, limit: PAGE });
      setEntries(res.entries);
      setNextCursor(res.nextCursor);
      newestRef.current = res.entries[0]?.at ?? null;
    } catch (e) {
      const d = describeRequestError(e, "Couldn't load logs.");
      setError(d.message);
      setCanRetry(d.canRetry);
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    try {
      setIsLoadingMore(true);
      const res = await adminApi.logs({
        ...filters,
        before: nextCursor,
        limit: PAGE,
      });
      setEntries((prev) => [...prev, ...res.entries]);
      setNextCursor(res.nextCursor);
    } catch {
      /* keep what we have; the sentinel stays for a retry */
    } finally {
      setIsLoadingMore(false);
    }
  }, [filters, nextCursor, isLoadingMore]);

  const poll = useCallback(async () => {
    if (!newestRef.current) return;
    try {
      const res = await adminApi.logs({
        ...filters,
        since: newestRef.current,
        limit: PAGE,
      });
      if (!res.entries.length) return;
      newestRef.current = res.entries[0].at;
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e._id));
        const fresh = res.entries.filter((e) => !seen.has(e._id));
        return [...fresh, ...prev].slice(0, RENDER_CAP);
      });
    } catch {
      /* ignore transient poll failures */
    }
  }, [filters]);

  useEffect(() => {
    if (!tailing) return;
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [tailing, poll]);

  const setFilters = useCallback((next: LogFilters) => {
    setFiltersState(next);
  }, []);

  return {
    filters,
    entries,
    nextCursor,
    isLoading,
    isLoadingMore,
    error,
    canRetry,
    tailing,
    setFilters,
    loadMore,
    toggleTail: () => setTailing((t) => !t),
    refetch: loadInitial,
  };
}
