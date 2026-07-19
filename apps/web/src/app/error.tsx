"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Court Watch page failure", {
      message: error.message,
      digest: error.digest,
    });
  }, [error]);

  return (
    <main className="min-h-dvh bg-[#071323] px-5 py-16 text-white">
      <section className="mx-auto max-w-md border border-white/15 bg-[#111f30] p-6 shadow-2xl">
        <WifiOff
          aria-hidden="true"
          className="mb-4 text-orange-500"
          size={32}
        />
        <h1 className="text-2xl font-bold">Court Watch could not load</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Your saved teams remain intact. Retry the connection to load the
          latest tournament data.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 flex min-h-12 w-full items-center justify-center gap-2 bg-orange-600 px-4 font-bold text-white"
        >
          <RefreshCw aria-hidden="true" size={20} />
          Retry
        </button>
      </section>
    </main>
  );
}
