"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "pressable inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-[13px] font-medium disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary hover:bg-primary/90",
        outline: "border border-line bg-surface text-ink hover:border-line-hover hover:bg-surface2",
        ghost:   "text-ink-soft hover:bg-surface2 hover:text-ink",
        icon:    "border border-line bg-surface text-ink-soft hover:text-ink hover:border-line-hover",
        blush:   "bg-accent-soft text-accent hover:bg-accent/15",
        danger:  "border border-bad/30 text-bad hover:bg-bad/10",
      },
      size: {
        default: "h-10 px-4",
        sm:      "h-8 px-3 text-[12.5px]",
        lg:      "h-11 px-5 text-[14px]",
        icon:    "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
