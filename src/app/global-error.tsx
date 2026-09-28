"use client";

import "./globals.css";

/** Last-resort boundary for errors in the root layout. Must render its own <html>/<body>. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-AU">
      <body className="grid min-h-dvh place-items-center bg-sand-50 p-6 text-center">
        <div>
          <h1 className="text-4xl">Roavela is having a moment</h1>
          <p className="mt-3 text-mist">Something went wrong on our side. Please try again.</p>
          <button type="button" onClick={reset} className="mt-8 h-11 rounded-full bg-eucalypt-700 px-6 font-semibold text-white">
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
