"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { CalendarIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateLong } from "@/lib/invoices";
import { cn } from "@/lib/utils";

/**
 * The calendar grid pulls in react-day-picker and date-fns — the largest
 * dependency on the editor route after Firebase, ~200 KB decoded — but it only
 * renders once the user opens the popover, and both invoice dates are
 * pre-filled with sensible defaults. Loading it on demand takes that weight off
 * first paint of the page where invoices are actually written.
 */
const Calendar = dynamic(
  () => import("@/components/ui/calendar").then((m) => m.Calendar),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[304px] w-[294px] animate-pulse rounded-md bg-slate-100 dark:bg-slate-800"
        aria-label="Loading calendar"
      />
    ),
  }
);

interface DatePickerFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  /** Focus target for `focusFirstInvoiceIssue` — see components/ui/select-field.tsx. */
  "data-invoice-field"?: string;
}

const parseDateValue = (value: string): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map((segment) => Number(segment));
  if (!year || !month || !day) {
    return undefined;
  }

  const parsedDate = new Date(year, month - 1, day);
  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  return parsedDate;
};

const formatDateValue = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function DatePickerField({
  value,
  onValueChange,
  className,
  disabled = false,
  placeholder = "Select date",
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "data-invoice-field": dataInvoiceField,
}: DatePickerFieldProps) {
  const [open, setOpen] = React.useState(false);
  const selectedDate = React.useMemo(() => parseDateValue(value), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          id={id}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          data-invoice-field={dataInvoiceField}
          className={cn(
            "h-10 w-full justify-start text-left font-normal",
            !selectedDate && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selectedDate ? formatDateLong(selectedDate) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            if (!date) {
              return;
            }
            onValueChange(formatDateValue(date));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
