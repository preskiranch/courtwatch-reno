import type { Metadata } from "next";
import {
  SiteShell,
  SiteStepList,
  SourceNote,
  TrophyHeading,
  WhiteCard,
} from "../../components/site/site-shell";

export const metadata: Metadata = {
  title: "Install Court Watch AAU",
  description: "Add Court Watch AAU to an iPhone or Android Home Screen.",
};

export default function InstallPage() {
  return (
    <SiteShell
      eyebrow="Install"
      title="Put Court Watch AAU on your phone"
      description="Court Watch AAU is built as an installable web app, so families can open the tracker from the Home Screen without waiting on an app-store release."
    >
      <WhiteCard>
        <TrophyHeading
          title="iPhone install steps"
          body="Use Safari for the cleanest iPhone Home Screen install."
        />
        <div className="mt-5">
          <SiteStepList
            steps={[
              {
                title: "Open the site in Safari",
                body: "Use the Court Watch AAU link or scan the QR code from another device.",
              },
              {
                title: "Tap the share button",
                body: "In Safari, use the share icon at the bottom of the browser.",
              },
              {
                title: "Choose Add to Home Screen",
                body: "Keep the name Court Watch AAU, then tap Add.",
              },
              {
                title: "Open from the Home Screen",
                body: "Your saved teams stay tied to that device. Refresh inside the app when schedules change.",
              },
            ]}
          />
        </div>
      </WhiteCard>

      <WhiteCard>
        <TrophyHeading
          title="Android install steps"
          body="Chrome and most Android browsers can install the same tracker."
        />
        <div className="mt-5">
          <SiteStepList
            steps={[
              {
                title: "Open the site in Chrome",
                body: "Use the shared link or scan the Court Watch AAU QR code.",
              },
              {
                title: "Open the browser menu",
                body: "Tap the three-dot menu and choose Install app or Add to Home screen.",
              },
              {
                title: "Confirm the install",
                body: "The tracker will appear with your other apps.",
              },
            ]}
          />
        </div>
      </WhiteCard>

      <WhiteCard>
        <TrophyHeading
          title="Saved teams"
          body="Followed teams stay per device unless you choose to sign in."
        />
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-lg font-black text-slate-950">
            Using more than one device
          </h2>
          <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
            Create a free account from the Teams page to carry followed teams
            across your phone, tablet, and computer. Once you are signed in on
            each device, followed teams sync automatically. Without signing in,
            saved teams remain on the device where they were followed.
          </p>
        </div>
        <div className="mt-4">
          <SourceNote />
        </div>
      </WhiteCard>
    </SiteShell>
  );
}
