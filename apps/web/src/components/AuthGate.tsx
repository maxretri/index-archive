import { useEffect, useState, type ReactNode } from "react";
import { api, getSession, setSession } from "../api";

function telegramUserId() {
  const id = window.Telegram?.WebApp.initDataUnsafe?.user?.id;
  return id === undefined ? undefined : String(id);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"loading" | "ready" | "error">(getSession(telegramUserId()) ? "ready" : "loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const telegram = window.Telegram?.WebApp;
    telegram?.setHeaderColor("#f7f7f3");
    telegram?.setBackgroundColor("#f7f7f3");
    telegram?.expand();
    telegram?.ready();
    if (getSession(telegramUserId())) return;
    if (!telegram?.initData) {
      setMessage("Open INDEX from its Telegram bot. Authentication is only available inside Telegram.");
      setState("error");
      return;
    }
    api.authenticate(telegram.initData)
      .then(({ token }) => { setSession(token); setState("ready"); })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Telegram authentication failed");
        setState("error");
      });
  }, []);

  if (state === "ready") return children;
  return (
    <main className="gate">
      <div className="wordmark">INDEX</div>
      {state === "loading" ? <div className="gate-line" aria-label="Authenticating" /> : (
        <div className="gate-message"><p>{message}</p><small>FORWARD ANYTHING. FIND EVERYTHING.</small></div>
      )}
    </main>
  );
}
