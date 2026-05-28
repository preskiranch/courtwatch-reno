"use client";

import { useEffect, useState } from "react";
import {
  buildLegacyDomainMigrationUrl,
  isLegacyMigrationHost,
} from "../lib/domain-migration";

export function DomainMigrationGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const [migrating, setMigrating] = useState(false);

  useEffect(() => {
    if (!isLegacyMigrationHost()) return;
    setMigrating(true);
    const target = buildLegacyDomainMigrationUrl();
    const timer = window.setTimeout(() => {
      window.location.replace(target);
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

  if (!migrating) return <>{children}</>;

  return (
    <main className="grid min-h-dvh place-items-center bg-[#07111f] px-5 text-white">
      <section className="w-full max-w-sm rounded-xl border border-white/10 bg-white p-5 text-slate-950 shadow-2xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">
          Court Watch AAU
        </p>
        <h1 className="mt-2 text-2xl font-black">Moving you to the new site</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          Your saved teams and device settings are being carried over to
          courtwatchaau.com.
        </p>
      </section>
    </main>
  );
}
