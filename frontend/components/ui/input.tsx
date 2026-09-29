import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none focus:border-grad2 focus:ring-2 focus:ring-grad2/20",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
