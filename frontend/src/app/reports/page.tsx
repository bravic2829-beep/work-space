import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { ReportsHub } from "@/features/reports/ReportsHub";

export default function ReportsPage() {
  return (
    <RequireAuth>
      <AppShell>
        <ReportsHub />
      </AppShell>
    </RequireAuth>
  );
}
