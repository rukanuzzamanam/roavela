import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

const COPY = {
  expired: { title: "This reset link has expired", body: "For your security, reset links only work for a short time. Request a new one below." },
  used: { title: "This reset link has already been used", body: "Each link works once. If you still need to reset your password, request a new link." },
  invalid: { title: "This reset link isn't valid", body: "It may have been copied incorrectly or replaced by a newer link. Request a new one below." },
} as const;

export function ResetLinkProblem({ reason }: { reason: keyof typeof COPY }) {
  return (
    <div role="alert" className="space-y-5">
      <div className="flex items-start gap-3 rounded-2xl bg-ochre-50 p-4">
        <Icon name="alert" size={22} className="mt-0.5 shrink-0 text-ochre-600" />
        <div>
          <p className="font-semibold">{COPY[reason].title}</p>
          <p className="mt-1 text-sm text-ink-soft">{COPY[reason].body}</p>
        </div>
      </div>
      <Link href="/forgot-password" className={buttonClasses({ size: "lg", className: "w-full" })}>
        Request a new link
      </Link>
    </div>
  );
}
