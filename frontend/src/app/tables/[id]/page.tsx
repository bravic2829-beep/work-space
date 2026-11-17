import { Suspense } from "react";

import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { TableRoute } from "@/features/tables/TableRoute";

type Props = { params: Promise<{ id: string }> };

// The id of the route is only known per request, so it is read inside a Suspense boundary.
async function Table({ params }: Props) {
  const { id } = await params;
  return (
    <RequireAuth>
      <AppShell>
        <TableRoute tableId={id} />
      </AppShell>
    </RequireAuth>
  );
}

export default function TablePage({ params }: Props) {
  return (
    <Suspense fallback={<p role="status">Loading…</p>}>
      <Table params={params} />
    </Suspense>
  );
}
