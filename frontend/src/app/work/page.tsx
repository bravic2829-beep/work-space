import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { WorkScreen } from "@/features/sheets/WorkScreen";

export default function WorkPage() {
  return (
    <RequireAuth>
      <AppShell>
        <WorkScreen />
      </AppShell>
    </RequireAuth>
  );
}
