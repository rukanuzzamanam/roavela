import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icons";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-[var(--radius-card)] border border-ink/8 bg-white shadow-card", className)} {...props} />;
}

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: "neutral" | "demo" | "success" | "warning" | "accent" }) {
  const tones = {
    neutral: "bg-sand-100 text-ink-soft",
    demo: "bg-ink/80 text-white backdrop-blur",
    success: "bg-eucalypt-100 text-eucalypt-800",
    warning: "bg-ochre-100 text-ochre-700",
    accent: "bg-ochre-500 text-white",
  };
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", tones[tone], className)}
      {...props}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-sand-200/70", className)} />;
}

export function Rating({
  value,
  count,
  className,
  showCount = true,
}: {
  value: number | null;
  count: number;
  className?: string;
  showCount?: boolean;
}) {
  if (value === null || count === 0) {
    return <span className={cn("text-sm font-medium text-mist", className)}>New</span>;
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm font-semibold", className)}>
      <Icon name="star" size={15} className="fill-ochre-400 text-ochre-400" />
      <span>{value.toFixed(1)}</span>
      {showCount && (
        <span className="font-normal text-mist">
          ({count}
          <span className="sr-only"> reviews</span>)
        </span>
      )}
      <span className="sr-only">out of 5 stars</span>
    </span>
  );
}

interface StateProps {
  icon?: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon = "compass", title, description, action, className }: StateProps) {
  return (
    <div className={cn("flex flex-col items-center rounded-3xl border border-dashed border-ink/15 bg-white/60 px-6 py-14 text-center", className)}>
      <span className="mb-4 grid size-14 place-items-center rounded-full bg-eucalypt-50 text-eucalypt-600">
        <Icon name={icon} size={26} />
      </span>
      <h2 className="font-display text-2xl">{title}</h2>
      {description && <p className="mt-2 max-w-md text-mist">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, action, className }: Partial<StateProps>) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-3xl border border-ochre-200 bg-ochre-50 px-6 py-12 text-center", className)}>
      <span className="mb-4 grid size-14 place-items-center rounded-full bg-ochre-100 text-ochre-600">
        <Icon name="alert" size={26} />
      </span>
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="mt-2 max-w-md text-ink-soft">
        {description ?? "We couldn't load this right now. Please check your connection and try again."}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
