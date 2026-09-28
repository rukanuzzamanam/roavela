import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="container-page grid min-h-[calc(100dvh-4rem)] items-center py-10 lg:grid-cols-2 lg:gap-16">
      <div
        aria-hidden
        className="hidden h-full max-h-[40rem] rounded-[2rem] bg-eucalypt-900 bg-[url(/brand/hero.svg)] bg-cover bg-bottom lg:block"
      />
      <div className="mx-auto w-full max-w-md">
        <h1 className="text-4xl">{title}</h1>
        <p className="mt-2 mb-8 text-mist">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
