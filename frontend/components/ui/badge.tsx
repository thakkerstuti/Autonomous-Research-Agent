import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[11.5px] font-medium leading-none before:h-[5px] before:w-[5px] before:rounded-full before:bg-current before:content-['']",
  {
    variants: {
      variant: {
        default: "bg-surface3 text-ink-soft",
        ready:   "bg-ok/10 text-ok",
        review:  "bg-warn/10 text-warn",
        bad:     "bg-bad/10 text-bad",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
