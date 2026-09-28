import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60dvh] flex-col items-center justify-center py-16 text-center">
      <p className="font-display text-8xl text-eucalypt-200">404</p>
      <div className="road-line my-6 w-48 text-ochre-400" aria-hidden />
      <h1 className="text-4xl">Looks like a wrong turn</h1>
      <p className="mt-3 max-w-md text-mist">We couldn&apos;t find that page. It may have moved, or the stay may no longer be listed.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/">Back to home</ButtonLink>
        <ButtonLink href="/search" variant="outline">
          Find a stay
        </ButtonLink>
      </div>
    </div>
  );
}
