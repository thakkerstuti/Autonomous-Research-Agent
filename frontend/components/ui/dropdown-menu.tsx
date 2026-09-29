"use client";

import * as React from "react";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;

export function DropdownMenuContent({ className, ...props }: DropdownPrimitive.DropdownMenuContentProps) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={6}
        className={cn("z-50 min-w-[160px] rounded-lg border border-line bg-surface2 p-1 shadow-lg", className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: DropdownPrimitive.DropdownMenuItemProps) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        "cursor-pointer rounded-md px-2.5 py-1.5 text-sm text-ink-soft outline-none hover:bg-surface hover:text-ink",
        className
      )}
      {...props}
    />
  );
}
