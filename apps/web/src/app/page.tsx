import { CourtWatchApp } from "../components/courtwatch-app";
import { DomainMigrationGate } from "../components/domain-migration-gate";

export default function Home() {
  return (
    <DomainMigrationGate>
      <CourtWatchApp />
    </DomainMigrationGate>
  );
}
