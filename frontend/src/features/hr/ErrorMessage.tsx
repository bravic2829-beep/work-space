import { ApiError } from "@/lib/api/client";

/** Shows an API error, including the per-field messages of a 422 answer. */
export function ErrorMessage({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  const fields = error instanceof ApiError ? error.fieldErrors : [];
  return (
    <div role="alert">
      <p>{message}</p>
      {fields.length > 0 && (
        <ul>
          {fields.map((item, index) => (
            <li key={`${item.field}-${index}`}>
              {item.field}: {item.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
