import { cn } from "@/lib/utils";

/** Roavela wordmark: a winding road forming a stylised "R" horizon. */
export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden focusable="false">
        <circle cx="16" cy="16" r="16" className={inverted ? "fill-white" : "fill-eucalypt-700"} />
        <circle cx="21.5" cy="11" r="3.2" className="fill-ochre-400" />
        <path
          d="M5 24c4.5-.5 7-2.5 8.5-5.500S17 13 22 13.5"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className={inverted ? "stroke-eucalypt-700" : "stroke-white"}
        />
        <path
          d="M5 24c4.5-.5 7-2.5 8.5-5.500S17 13 22 13.5"
          fill="none"
          strokeWidth="0.9"
          strokeDasharray="1.6 1.8"
          className="stroke-ochre-300"
        />
      </svg>
      <span className={cn("font-display text-[1.45rem] font-semibold tracking-tight", inverted ? "text-white" : "text-eucalypt-800")}>
        roavela
      </span>
    </span>
  );
}
