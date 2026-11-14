import { cn } from "@/lib/utils";

/** Shared page title block: heading, short accent rule, one line of context. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-6", className)}>
      <div className="min-w-0">
        <h1 className="font-serif text-display font-normal text-ink">{title}</h1>
        {description && <p className="mt-3 max-w-[56ch] text-body-lg text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
