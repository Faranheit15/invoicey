"use client";

import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CaretSortIcon,
  ArrowUpIcon,
  ArrowDownIcon,
} from "@radix-ui/react-icons";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: string;
  order?: "asc" | "desc";
  onSort?: (key: string) => void;
  isLoading?: boolean;
  emptyState?: ReactNode;
  minWidth?: number;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  order,
  onSort,
  isLoading,
  emptyState,
  minWidth = 860,
}: DataTableProps<T>) {
  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div className="overflow-x-auto">
      <Table style={{ minWidth }}>
        <TableHeader>
          <TableRow>
            {columns.map((col) => {
              const active = sort === col.key;
              return (
                <TableHead key={col.key} className={col.className}>
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className="group inline-flex items-center gap-1 transition-colors hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      {col.header}
                      {active ? (
                        order === "asc" ? (
                          <ArrowUpIcon className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownIcon className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <CaretSortIcon className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 dark:text-slate-600" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading
            ? Array.from({ length: 6 }).map((_, r) => (
                <TableRow key={`sk-${r}`}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      <Skeleton className="h-4 w-full max-w-[140px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={cn(col.className)}>
                      {col.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
      {showEmpty ? emptyState : null}
    </div>
  );
}
