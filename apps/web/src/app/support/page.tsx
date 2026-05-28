import type { Metadata } from "next";
import {
  SiteShell,
  SiteStepList,
  SourceNote,
  TrophyHeading,
  WhiteCard,
} from "../../components/site/site-shell";

export const metadata: Metadata = {
  title: "Court Watch AAU Support",
  description: "Support information for Court Watch AAU families and coaches.",
};

export default function SupportPage() {
  return (
    <SiteShell
      eyebrow="Support"
      title="Help for families, coaches, and teams"
      description="Use this page when a saved team, score, bracket, or tournament list needs a quick check."
    >
      <WhiteCard>
        <TrophyHeading
          title="Quick fixes"
          body="Most display issues come from stale mobile browser cache or a team not being followed on that device."
        />
        <div className="mt-5">
          <SiteStepList
            steps={[
              {
                title: "Tap Refresh",
                body: "Use the refresh button at the top of the app to pull the newest saved data.",
              },
              {
                title: "Check the Teams tab",
                body: "Make sure the team says Following on that same phone or tablet.",
              },
              {
                title: "Open the tournament selector",
                body: "If multiple tournaments are listed, confirm the right event is selected.",
              },
              {
                title: "Use the official link",
                body: "Every team and bracket card includes source links when they are available.",
              },
            ]}
          />
        </div>
      </WhiteCard>

      <WhiteCard>
        <TrophyHeading
          title="Report an issue"
          body="Send the tournament name, team name, division, and a screenshot if possible."
        />
        <p className="mt-4 rounded-lg bg-slate-100 p-3 text-sm font-semibold leading-6 text-slate-600">
          Include the tournament name, team name, division, device type, and a
          screenshot so the issue can be checked quickly.
        </p>
      </WhiteCard>

      <WhiteCard>
        <TrophyHeading
          title="Official data"
          body="Court Watch AAU mirrors public tournament source data and keeps old data visible when a source temporarily fails."
        />
        <div className="mt-4">
          <SourceNote />
        </div>
      </WhiteCard>
    </SiteShell>
  );
}
