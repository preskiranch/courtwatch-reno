import type { Metadata } from "next";
import {
  SiteShell,
  SourceNote,
  TrophyHeading,
  WhiteCard,
} from "../../components/site/site-shell";

export const metadata: Metadata = {
  title: "Court Watch AAU Terms",
  description: "Terms and disclaimer for Court Watch AAU.",
};

const terms = [
  {
    title: "Use official rulings",
    body: "Court Watch AAU is a companion tracker. Tournament staff, official scorekeepers, and official source pages control schedules, courts, scores, brackets, and final rulings.",
  },
  {
    title: "Data can change",
    body: "Tournament data can change quickly. The app keeps the latest successfully synced data visible, but families should confirm important game details with official tournament sources.",
  },
  {
    title: "No affiliation",
    body: "Court Watch AAU is independent and is not affiliated with Jam On It, Grassroots 365, Exposure Events, or any tournament operator unless a written partnership is later announced.",
  },
  {
    title: "Device-scoped follows",
    body: "Saved teams are intended to be per device. Clearing browser data, changing browsers, or opening from another device can create a separate saved-team list.",
  },
];

export default function TermsPage() {
  return (
    <SiteShell
      eyebrow="Terms"
      title="Terms and disclaimer"
      description="Court Watch AAU is built for fast tournament tracking, but official tournament staff remain the authority."
    >
      <WhiteCard>
        <TrophyHeading
          title="Terms of use"
          body="Use the tracker as a convenience layer over official tournament information."
        />
        <div className="mt-5 space-y-3">
          {terms.map((term) => (
            <article
              key={term.title}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h2 className="text-lg font-black text-slate-950">
                {term.title}
              </h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                {term.body}
              </p>
            </article>
          ))}
        </div>
      </WhiteCard>

      <WhiteCard>
        <TrophyHeading
          title="Official schedules and rulings"
          body="Always use tournament staff instructions when a source page and Court Watch AAU disagree."
        />
        <div className="mt-4">
          <SourceNote />
        </div>
      </WhiteCard>
    </SiteShell>
  );
}
