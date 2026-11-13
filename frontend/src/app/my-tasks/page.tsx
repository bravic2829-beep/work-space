import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { MyTasksScreen } from "@/features/mytasks/MyTasksScreen";

export default function MyTasksPage() {
  return (
    <RequireAuth>
      <AppShell>
        <MyTasksScreen />
      </AppShell>
    </RequireAuth>
  );
}
