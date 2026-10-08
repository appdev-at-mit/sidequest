import { createContext, useContext, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { post, type Auth } from "./api";
export const AuthContext = createContext<Auth | undefined>(undefined);
export const useAuth = () => useContext(AuthContext)!;
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!auth)
    return (
      <Page title="Connecting…">
        <p>Waiting for the API. Use Retry above if the connection failed.</p>
      </Page>
    );
  return auth.user ? children : <Navigate to="/login" replace />;
}
export function Page({
  title,
  children,
  subtitle,
}: {
  title: string;
  children: ReactNode;
  subtitle?: string;
}) {
  return (
    <main className="page">
      <Link to="/" className="back-link">
        <ArrowLeft size={16} />
        Back to campus
      </Link>
      <h1>{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
      {children}
      <footer>
        <Link to="/terms">Terms & safety</Link>
        <Link to="/support">Support & reports</Link>
        <span>Made for little moments of campus kindness.</span>
      </footer>
    </main>
  );
}
export function QueryState({
  query,
}: {
  query: {
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    refetch: () => unknown;
  };
}) {
  return query.isPending ? (
    <p className="state">Loading…</p>
  ) : query.isError ? (
    <div role="alert" className="error">
      {query.error?.message}{" "}
      <button onClick={() => query.refetch()}>Try again</button>
    </div>
  ) : null;
}
export function useAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, data }: { path: string; data?: any }) =>
      post(path, data),
    onSuccess: () => client.invalidateQueries(),
  });
}
export function ActionStatus({
  action,
}: {
  action: ReturnType<typeof useAction>;
}) {
  return (
    <>
      {action.isError && (
        <p role="alert" className="error">
          {action.error.message}
        </p>
      )}
      {action.isSuccess && (
        <p role="status" className="success">
          Saved successfully.
        </p>
      )}
    </>
  );
}
export function TermsGate() {
  const auth = useAuth();
  const action = useAction();
  if (!auth?.user || auth.user.termsVersion === auth.termsVersion) return null;
  return (
    <div className="notice">
      <p>
        Read the <Link to="/terms">draft Terms & Safety</Link> before posting or
        accepting a quest.
      </p>
      <button
        className="button"
        disabled={action.isPending}
        onClick={() =>
          action.mutate({
            path: "/users/me/terms",
            data: { version: auth.termsVersion },
          })
        }
      >
        I have read and accept these terms
      </button>
      <ActionStatus action={action} />
    </div>
  );
}
