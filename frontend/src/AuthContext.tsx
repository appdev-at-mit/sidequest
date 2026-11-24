import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type AuthContextType = {
  isLoggedIn: boolean;
  checkingSession: boolean;
  setIsLoggedIn: (value: boolean) => void;
  userName: string;
  setUserName: (value: string) => void;
  userKerb: string;
  setUserKerb: (value: string) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const [checkingSession, setCheckingSession] = useState(true);
  const [userName, setUserName] = useState("");
  const [userKerb, setUserKerb] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function checkLogin() {
      try {
        const response = await fetch("/api/auth-status", { signal: controller.signal });
        const data = response.ok ? await response.json() : null;
        if (!controller.signal.aborted) {
          setIsLoggedIn(data?.isLoggedIn === true);
          setUserName(data?.name ?? "");
          setUserKerb(data?.kerb ?? "");
        }
      } catch {
        if (!controller.signal.aborted) setIsLoggedIn(false);
      } finally {
        if (!controller.signal.aborted) setCheckingSession(false);
      }
    }

    void checkLogin();
    return () => controller.abort();
  }, []);

  return (
    <AuthContext.Provider value={{ isLoggedIn, checkingSession, setIsLoggedIn, userName, setUserName, userKerb, setUserKerb }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be inside AuthProvider");
  }

  return context;
}
