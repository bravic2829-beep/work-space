import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { ReportsScreen } from "@/features/reports/ReportsScreen";

export default function ReportsPage() {
  return (
    <RequireAuth>
      <AppShell>
        <ReportsScreen />
      </AppShell>
    </RequireAuth>
  );
}
