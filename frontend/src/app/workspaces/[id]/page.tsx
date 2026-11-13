import { Suspense } from "react";

import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { WorkspaceScreen } from "@/features/tables/WorkspaceScreen";

type Props = { params: Promise<{ id: string }> };

// The id of the route is only known per request, so it is read inside a Suspense boundary.
async function Workspace({ params }: Props) {
  const { id } = await params;
  return (
    <RequireAuth>
      <AppShell>
        <WorkspaceScreen workspaceId={id} />
      </AppShell>
    </RequireAuth>
  );
}

export default function WorkspacePage({ params }: Props) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <Workspace params={params} />
    </Suspense>
  );
}
