"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { describeRequestError } from "@/lib/api-client";
import type { QueryParams } from "@/lib/api-client";

interface Page<T> {
  data: T[];
  total: number;
}

/**
 * Server-driven table state: page, sort, search, and arbitrary filters, all
 * refetched from a single `fetcher`. No client-side sort/filter engine — the
 * API does the work (consistent with the app's no-extra-libs ethos).
 */
export function useServerTable<T>({
  fetcher,
  initialSort,
  initialOrder = "desc",
  pageSize = 25,
  initialFilters = {},
}: {
  fetcher: (params: QueryParams) => Promise<Page<T>>;
  initialSort?: string;
  initialOrder?: "asc" | "desc";
  pageSize?: number;
  initialFilters?: QueryParams;
}) {
  const [page, setPage] = useState(1);
  const [sort, setSortState] = useState<string | undefined>(initialSort);
  const [order, setOrder] = useState<"asc" | "desc">(initialOrder);
  const [search, setSearchState] = useState("");
  const [filters, setFiltersState] = useState<QueryParams>(initialFilters);
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [canRetry, setCanRetry] = useState(false);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError("");
      const params: QueryParams = {
        page,
        limit: pageSize,
        ...(sort ? { sort, order } : {}),
        ...(search ? { q: search } : {}),
        ...filters,
      };
      const res = await fetcherRef.current(params);
      setData(res.data);
      setTotal(res.total);
    } catch (e) {
      const described = describeRequestError(e, "Couldn't load data.");
      setError(described.message);
      setCanRetry(described.canRetry);
      setData([]);
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, sort, order, search, filters]);

  useEffect(() => {
    load();
  }, [load]);

  const setSort = useCallback(
    (field: string) => {
      if (sort === field) {
        setOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSortState(field);
        setOrder("desc");
      }
      setPage(1);
    },
    [sort]
  );

  const setSearch = useCallback((q: string) => {
    setSearchState(q);
    setPage(1);
  }, []);

  const setFilters = useCallback((next: QueryParams) => {
    setFiltersState(next);
    setPage(1);
  }, []);

  return {
    data,
    total,
    page,
    pageSize,
    sort,
    order,
    search,
    filters,
    isLoading,
    error,
    canRetry,
    setPage,
    setSort,
    setSearch,
    setFilters,
    refetch: load,
  };
}
