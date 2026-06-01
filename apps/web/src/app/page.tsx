import { CourtWatchApp } from "../components/courtwatch-app";
import { CourtVisionApp } from "../components/courtvision-app";
import { DomainMigrationGate } from "../components/domain-migration-gate";

export default function Home() {
  if (process.env.NEXT_PUBLIC_APP_TARGET === "courtvision") {
    return <CourtVisionApp />;
  }

  return (
    <DomainMigrationGate>
      <CourtWatchApp />
    </DomainMigrationGate>
  );
}
