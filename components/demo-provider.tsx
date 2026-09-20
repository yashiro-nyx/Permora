"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createSeed,
  parseStored,
  STORAGE_KEY,
  transition,
} from "@/lib/demo-service";
import { DemoCommand, DemoState, Role, User, profiles } from "@/lib/model";

type DemoContextValue = {
  state: DemoState;
  user: User | null;
  ready: boolean;
  storageError: string;
  notice: string;
  setNotice: (value: string) => void;
  login: (role: Role) => void;
  logout: () => void;
  reset: () => void;
  dispatch: (command: DemoCommand) => DemoState;
};
const Context = createContext<DemoContextValue | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DemoState>(createSeed);
  const [userId, setUserId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState("");
  const stateRef = useRef(state);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const initial = saved ? parseStored(saved) : createSeed();
      stateRef.current = initial;
      setState(initial);
      const serialized = JSON.stringify(initial);
      if (!saved || serialized !== saved) {
        localStorage.setItem(STORAGE_KEY, serialized);
      }
      setUserId(sessionStorage.getItem("permora-demo-profile"));
    } catch {
      setStorageError(
        "Saved demo data could not be loaded. Reset demo data to recover, or allow browser storage.",
      );
    }
    setReady(true);
    function sync(e: StorageEvent) {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const next = parseStored(e.newValue);
          stateRef.current = next;
          setState(next);
        } catch {
          setStorageError(
            "Demo data changed in another tab and could not be read. Reset to recover.",
          );
        }
      }
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const dispatch = useCallback(
    (command: DemoCommand) => {
      if (!userId) throw new Error("Choose a demo profile first.");
      let current = stateRef.current;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) current = parseStored(raw);
      } catch {
        throw new Error(
          "Browser storage is unavailable or corrupt. Reset demo data to continue.",
        );
      }
      const next = transition(current, userId, command);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        throw new Error(
          "Changes were not saved. Browser storage may be full or disabled.",
        );
      }
      stateRef.current = next;
      setState(next);
      return next;
    },
    [userId],
  );
  const login = (role: Role) => {
    const profile = stateRef.current.users.find((u) => u.id === profiles[role]);
    if (!profile?.active)
      throw new Error(
        "This demo profile is inactive. Reactivate it in User Management using an administrator.",
      );
    sessionStorage.setItem("permora-demo-profile", profile.id);
    setUserId(profile.id);
  };
  const logout = () => {
    sessionStorage.removeItem("permora-demo-profile");
    setUserId(null);
    setNotice("");
  };
  const reset = () => {
    try {
      const seed = createSeed();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      stateRef.current = seed;
      setState(seed);
      setStorageError("");
      setNotice(
        "Demo data reset. The original sample requests have been restored.",
      );
    } catch {
      setStorageError(
        "Reset failed. Please allow local browser storage and try again.",
      );
    }
  };
  return (
    <Context.Provider
      value={{
        state,
        user: state.users.find((u) => u.id === userId) ?? null,
        ready,
        storageError,
        notice,
        setNotice,
        login,
        logout,
        reset,
        dispatch,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDemo() {
  const value = useContext(Context);
  if (!value) throw new Error("DemoProvider is required");
  return value;
}
