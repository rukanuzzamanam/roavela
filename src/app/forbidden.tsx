import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export default function Forbidden() {
  return (
    <div className="container-page flex min-h-[60dvh] flex-col items-center justify-center py-16 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-ochre-50 text-ochre-600">
        <Icon name="shield" size={30} />
      </span>
      <h1 className="mt-6 text-4xl">This area isn&apos;t available to you</h1>
      <p className="mt-3 max-w-md text-mist">Your account doesn&apos;t have access to this page.</p>
      <ButtonLink href="/" className="mt-8">
        Back to home
      </ButtonLink>
    </div>
  );
}
