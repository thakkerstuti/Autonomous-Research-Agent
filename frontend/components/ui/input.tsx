import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-xl border border-line bg-surface px-3.5 text-[13.5px] text-ink outline-none",
        "placeholder:text-ink-faint transition-[border-color,box-shadow] duration-150",
        "hover:border-line-hover focus:border-accent/60 focus:shadow-[0_0_0_3px_var(--accent-soft)] focus-visible:outline-none",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
