import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { HomeScreen } from "@/features/home/HomeScreen";

export default function Home() {
  return (
    <RequireAuth>
      <AppShell>
        <HomeScreen />
      </AppShell>
    </RequireAuth>
  );
}
