"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ApiError } from "@/lib/api/client";

import { fetchMe, login as loginRequest, logout as logoutRequest } from "./api";
import type { User } from "./schema";

type AuthState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: User }
  | { status: "error"; message: string };

type AuthContextValue = {
  state: AuthState;
  login: (employeeCode: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const user = await fetchMe(controller.signal);
        setState({ status: "authenticated", user });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: "anonymous" });
        } else {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const login = useCallback(
    async (employeeCode: string, password: string, rememberMe: boolean) => {
      const user = await loginRequest(employeeCode, password, rememberMe);
      setState({ status: "authenticated", user });
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch (error) {
      // 401 means the session was already gone: the user is signed out either way.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    setState({ status: "anonymous" });
  }, []);

  const value = useMemo(() => ({ state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
