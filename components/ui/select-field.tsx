"use client";

import { ChevronDownIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface SelectFieldOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectFieldOption[];
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  /**
   * For a select with no visible <label> (a filter bar control whose meaning is
   * carried by its own selected value). `Field`-wrapped selects keep using
   * `aria-labelledby`, which is what makes them announce "Currency INR" rather
   * than replacing the trigger text.
   */
  "aria-label"?: string;
  /**
   * Focus target for `focusFirstInvoiceIssue`. `Field` generates its ids with
   * `useId()`, so a data attribute is the only stable handle on a control.
   */
  "data-invoice-field"?: string;
}

export function SelectField({
  value,
  onValueChange,
  options,
  disabled = false,
  className,
  placeholder = "Select option",
  id,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
  "data-invoice-field": dataInvoiceField,
}: SelectFieldProps) {
  const selectedOption = options.find((option) => option.value === value);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          type="button"
          id={id}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          data-invoice-field={dataInvoiceField}
          className={cn(
            "h-10 w-full justify-between px-3 py-2 text-sm font-normal",
            className
          )}
        >
          {selectedOption?.label || placeholder}
          <ChevronDownIcon className="h-4 w-4 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[--radix-dropdown-menu-trigger-width]"
        align="start"
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onValueChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
