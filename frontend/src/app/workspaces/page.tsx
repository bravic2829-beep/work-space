import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { WorkspacesScreen } from "@/features/tables/WorkspacesScreen";

export default function WorkspacesPage() {
  return (
    <RequireAuth>
      <AppShell>
        <WorkspacesScreen />
      </AppShell>
    </RequireAuth>
  );
}
