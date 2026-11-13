import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { TrashScreen } from "@/features/trash/TrashScreen";

export default function TrashPage() {
  return (
    <RequireAuth>
      <AppShell>
        <TrashScreen />
      </AppShell>
    </RequireAuth>
  );
}
