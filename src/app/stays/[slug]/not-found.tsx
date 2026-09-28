import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";

export default function StayNotFound() {
  return (
    <div className="container-page py-16">
      <EmptyState
        icon="home"
        title="This stay isn't available"
        description="It may have been paused or removed by the host, or the link may be wrong."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <ButtonLink href="/search">Find another stay</ButtonLink>
            <ButtonLink href="/saved" variant="outline">
              Saved stays
            </ButtonLink>
          </div>
        }
      />
    </div>
  );
}
