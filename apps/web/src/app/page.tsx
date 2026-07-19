import { TargetApp } from "@courtwatch/app-target";
import { DomainMigrationGate } from "../components/domain-migration-gate";

const isCourtVision = process.env.NEXT_PUBLIC_APP_TARGET === "courtvision";

export default function Home() {
  if (isCourtVision) {
    return <TargetApp />;
  }

  return (
    <DomainMigrationGate>
      <TargetApp />
    </DomainMigrationGate>
  );
}
