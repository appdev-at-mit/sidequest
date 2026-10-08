import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Compass, ArrowUpRight } from "lucide-react";
import { post } from "../api";
import { useAuth, Page } from "../components";
export function Login() {
  const auth = useAuth();
  const client = useQueryClient();
  const navigate = useNavigate();
  const login = useMutation({
    mutationFn: (kerberosId: string) => post("/auth/dev-login", { kerberosId }),
    onSuccess: async () => {
      await client.invalidateQueries();
      navigate("/");
    },
  });
  if (auth?.user) return <Navigate to="/" replace />;
  return (
    <Page
      title="Welcome to SideQuest"
      subtitle="A little help, right around the corner."
    >
      <div className="panel login-panel">
        <Compass size={42} className="blue" />
        <h2>Your campus community</h2>
        {auth?.developmentLogin ? (
          <>
            <p className="notice">
              Development login only. These fictional accounts do not represent
              MIT students or verify student status.
            </p>
            {[
              ["demo-alex", "Alex Chen"],
              ["demo-maya", "Maya Patel"],
              ["demo-jordan", "Jordan Brooks"],
            ].map(([id, name]) => (
              <button
                key={id}
                className="account-choice"
                disabled={login.isPending}
                onClick={() => login.mutate(id)}
              >
                <span className="avatar">{name.charAt(0)}</span>Continue as{" "}
                {name}
                <ArrowUpRight size={17} />
              </button>
            ))}
          </>
        ) : (
          <p>
            MIT Touchstone login is awaiting service provider registration and
            approved student attributes. Login is unavailable in this
            deployment.
          </p>
        )}
        {login.isError && (
          <p role="alert" className="error">
            {login.error.message}
          </p>
        )}
        <Link to="/terms">Read our terms and safety policy</Link>
      </div>
    </Page>
  );
}
