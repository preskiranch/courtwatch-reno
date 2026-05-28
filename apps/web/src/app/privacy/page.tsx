import type { Metadata } from "next";
import {
  SiteShell,
  SourceNote,
  TrophyHeading,
  WhiteCard,
} from "../../components/site/site-shell";

export const metadata: Metadata = {
  title: "Court Watch AAU Privacy Policy",
  description: "Privacy policy for Court Watch AAU.",
};

const privacySections = [
  {
    title: "Information the app stores",
    body: "Court Watch AAU stores a random device identifier, followed team choices, notification preferences, push subscription data if enabled, and basic active-user presence counts.",
  },
  {
    title: "Tournament data",
    body: "The app displays team, schedule, score, bracket, venue, and final-results information from public tournament source pages or configured server-side APIs.",
  },
  {
    title: "Player search",
    body: "Court Watch AAU does not provide public registered-player search. Player roster data is not collected through the public web app.",
  },
  {
    title: "Notifications",
    body: "If push notifications are enabled, the app stores the browser push subscription needed to send schedule, score, court, and bracket alerts to that device.",
  },
  {
    title: "Per-device saved teams",
    body: "Followed teams are scoped to the current device. One user's saved teams should not change another user's saved teams.",
  },
  {
    title: "Contact",
    body: "For privacy questions, contact PreskiRanch LLC through @PreskiRanch on Instagram.",
  },
];

export default function PrivacyPage() {
  return (
    <SiteShell
      eyebrow="Privacy"
      title="Privacy Policy"
      description="Court Watch AAU is built to store only the information needed to keep tournament tracking useful on each device."
    >
      <WhiteCard>
        <TrophyHeading
          title="Privacy basics"
          body="The tracker is designed around tournament utility, device-scoped follows, and public schedule data."
        />
        <div className="mt-5 space-y-3">
          {privacySections.map((section) => (
            <article
              key={section.title}
              className="rounded-lg border border-slate-200 bg-white p-4"
            >
              <h2 className="text-lg font-black text-slate-950">
                {section.title}
              </h2>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                {section.body}
              </p>
            </article>
          ))}
        </div>
      </WhiteCard>

      <WhiteCard>
        <TrophyHeading
          title="Independent source"
          body="Court Watch AAU is not the tournament operator."
        />
        <div className="mt-4">
          <SourceNote />
        </div>
      </WhiteCard>
    </SiteShell>
  );
}
