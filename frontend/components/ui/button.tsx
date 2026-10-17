"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-medium transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none shadow-sm",
  {
    variants: {
      variant: {
        default: "bg-rose text-white hover:bg-rose/90 hover:shadow-panel",
        outline: "border border-line bg-surface text-ink-soft hover:text-ink hover:border-rose/50 hover:bg-blush/20",
        ghost:   "text-ink-soft hover:bg-surface2 hover:text-ink shadow-none",
        icon:    "bg-surface border border-line text-ink-soft hover:text-ink",
        blush:   "bg-blush text-rose border border-blush-deep hover:bg-blush-deep",
      },
      size: {
        default: "h-10 px-5",
        sm:      "h-8 px-3 text-xs",
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
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
