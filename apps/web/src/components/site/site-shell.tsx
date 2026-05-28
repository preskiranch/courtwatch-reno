import {
  Bell,
  Home,
  ShieldCheck,
  Smartphone,
  Trophy,
} from "lucide-react";
import type { ReactNode } from "react";

type SiteShellProps = {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
};

const siteLinks = [
  { href: "/", label: "Tracker" },
  { href: "/install", label: "Install" },
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

export function SiteShell({
  eyebrow,
  title,
  description,
  children,
}: SiteShellProps) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-5xl px-4 pb-16 pt-5 text-white">
      <header className="rounded-lg border border-white/12 bg-white/8 p-4 shadow-2xl backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <a
            href="/"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-black text-white"
          >
            <Home className="h-4 w-4 text-orange-300" />
            Court Watch AAU
          </a>
          <nav
            aria-label="Court Watch AAU pages"
            className="flex flex-wrap gap-2 text-xs font-black"
          >
            {siteLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-lg border border-white/10 bg-white/8 px-3 py-2 text-slate-200"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="mt-8 max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-4xl font-black leading-tight text-white sm:text-5xl">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-300">
            {description}
          </p>
        </div>
      </header>

      <section className="mt-5 grid gap-4 md:grid-cols-[1fr_18rem]">
        <div className="space-y-4">{children}</div>
        <aside className="space-y-4">
          <InfoCard
            icon={<Smartphone className="h-5 w-5" />}
            title="Installable"
            body="Add Court Watch AAU to an iPhone Home Screen from Safari and use it like an app."
          />
          <InfoCard
            icon={<Bell className="h-5 w-5" />}
            title="Live tracker"
            body="Follow teams by device, check schedules, records, brackets, alerts, and final placements."
          />
          <InfoCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title="Independent"
            body="Official schedules and rulings always come from tournament staff and source pages."
          />
        </aside>
      </section>

      <footer className="mt-8 rounded-lg border border-white/12 bg-white/8 p-4 text-sm font-semibold text-slate-300">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p>Designed by Preski Ranch LLC</p>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Court Watch AAU is an independent companion tracker and is not
          affiliated with Jam On It, Grassroots 365, Exposure Events, or any
          tournament operator. Official schedules and rulings come from
          tournament staff.
        </p>
      </footer>
    </main>
  );
}

export function InfoCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-lg border border-white/12 bg-white/8 p-4 shadow-xl">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-orange-500 text-white">
        {icon}
      </div>
      <h2 className="mt-3 text-lg font-black text-white">{title}</h2>
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-300">
        {body}
      </p>
    </article>
  );
}

export function WhiteCard({ children }: { children: ReactNode }) {
  return <section className="court-card p-5">{children}</section>;
}

export function SiteStepList({
  steps,
}: {
  steps: Array<{ title: string; body: string }>;
}) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li
          key={step.title}
          className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-950 text-sm font-black text-orange-300">
            {index + 1}
          </span>
          <span>
            <span className="block text-base font-black text-slate-950">
              {step.title}
            </span>
            <span className="mt-1 block text-sm font-semibold leading-6 text-slate-600">
              {step.body}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SourceNote() {
  return (
    <p className="rounded-lg bg-slate-100 p-3 text-sm font-semibold leading-6 text-slate-600">
      Court Watch AAU is a companion tracker. Tournament staff and official
      source pages control final schedules, scores, brackets, and rulings.
    </p>
  );
}

export function TrophyHeading({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-orange-500 text-white">
        <Trophy className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-2xl font-black text-slate-950">{title}</h2>
        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
          {body}
        </p>
      </div>
    </div>
  );
}
