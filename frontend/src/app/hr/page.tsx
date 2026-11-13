import { AppShell } from "@/components/AppShell";
import { RequireAdmin } from "@/features/auth/RequireAdmin";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { HrScreen } from "@/features/hr/HrScreen";

export default function HrPage() {
  return (
    <RequireAuth>
      <AppShell>
        <RequireAdmin>
          <HrScreen />
        </RequireAdmin>
      </AppShell>
    </RequireAuth>
  );
}
