"use client";

import { useEffect, useMemo, useState } from "react";

import { AppState, ProviderChoice } from "@/lib/types";

type Props = {
  initialState: AppState;
};

type TabId = "chat" | "code";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

export function ChatShell({ initialState }: Props) {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<TabId>("chat");
  const [providerId, setProviderId] = useState<ProviderChoice>("auto");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [resolvedProvider, setResolvedProvider] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [codeLanguage, setCodeLanguage] = useState<"javascript" | "python">("javascript");
  const [code, setCode] = useState('console.log("Hello from Sakha");');
  const [codeOutput, setCodeOutput] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const recentTasks = useMemo(() => state.tasks.slice(0, 6), [state.tasks]);

  async function runPrompt() {
    if (!prompt.trim()) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, providerId }),
      });

      const data = (await response.json()) as {
        message?: string;
        error?: string;
        resolvedProvider?: string;
        state?: AppState;
      };

      if (!response.ok) {
        throw new Error(data.error || "Request failed.");
      }

      setAnswer(data.message || "");
      setResolvedProvider(data.resolvedProvider || "Ready");
      if (data.state) {
        setState(data.state);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runCode() {
    setCodeLoading(true);
    setCodeOutput("");

    try {
      const response = await fetch("/api/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language: codeLanguage }),
      });

      const data = (await response.json()) as { output?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Code execution failed.");
      }

      setCodeOutput(data.output || "Finished with no output.");
    } catch (caughtError) {
      setCodeOutput(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setCodeLoading(false);
    }
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
      return;
    }

    setCodeOutput(
      "If the install button does not appear automatically, open this app in Chrome or Edge and use the browser menu to install it.",
    );
    setTab("code");
  }

  return (
    <main className="min-h-screen bg-transparent px-3 py-3 text-white md:px-4 md:py-4">
      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-7xl gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="glass flex flex-col rounded-[24px] p-3">
          <div className="rounded-[18px] bg-white/4 p-3">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Sakha</p>
            <p className="mt-2 text-sm text-slate-300">Personal workspace</p>
          </div>

          <div className="mt-3 grid gap-2">
            <button
              onClick={() => setTab("chat")}
              className={`rounded-[16px] px-3 py-3 text-left text-sm transition ${tab === "chat" ? "bg-lime-300 text-slate-950" : "bg-white/4 text-slate-200 hover:bg-white/8"}`}
            >
              Chat
            </button>
            <button
              onClick={() => setTab("code")}
              className={`rounded-[16px] px-3 py-3 text-left text-sm transition ${tab === "code" ? "bg-lime-300 text-slate-950" : "bg-white/4 text-slate-200 hover:bg-white/8"}`}
            >
              Code
            </button>
            <button
              onClick={installApp}
              className="rounded-[16px] bg-white/4 px-3 py-3 text-left text-sm text-slate-200 transition hover:bg-white/8"
            >
              Install app
            </button>
          </div>

          <div className="mt-4 rounded-[18px] bg-black/25 p-3">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Status</p>
            <p className="mt-2 text-sm text-white">{resolvedProvider}</p>
            <p className="mt-1 text-sm text-slate-400">
              {state.storageMode === "google-drive" ? "Cloud memory" : "Local memory"}
            </p>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-[18px] bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Recent</p>
            <div className="mt-3 space-y-2">
              {recentTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    setTab("chat");
                    setPrompt(task.instruction);
                  }}
                  className="w-full rounded-[14px] bg-white/4 px-3 py-3 text-left text-sm text-slate-200 transition hover:bg-white/8"
                >
                  <div className="line-clamp-1 font-medium text-white">{task.title}</div>
                  <div className="mt-1 line-clamp-2 text-slate-400">{task.instruction}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="glass-strong flex min-h-[70vh] flex-col rounded-[24px]">
          <header className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <div>
              <h1 className="text-lg font-medium text-white">{tab === "chat" ? "Sakha" : "Code Runner"}</h1>
              <p className="text-sm text-slate-400">
                {tab === "chat"
                  ? "Ask for anything. Sakha handles the routing in the background."
                  : "Write code, run it, debug it, and refine it."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={providerId}
                onChange={(event) => setProviderId(event.target.value as ProviderChoice)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="auto">Auto</option>
                {state.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>
          </header>

          {tab === "chat" ? (
            <>
              <div className="flex-1 overflow-auto px-4 py-4">
                <div className="mx-auto flex h-full max-w-4xl flex-col gap-4">
                  {!answer && !error ? (
                    <div className="rounded-[20px] border border-dashed border-white/10 bg-black/20 p-6 text-slate-400">
                      Ask Sakha to plan, write, research, summarize, debug, create dashboards, outline PPTs, or guide you through tasks.
                    </div>
                  ) : null}

                  {answer ? (
                    <div className="rounded-[20px] bg-black/25 p-5 text-sm leading-7 whitespace-pre-wrap text-slate-100">
                      {answer}
                    </div>
                  ) : null}

                  {error ? (
                    <div className="rounded-[20px] border border-rose-400/20 bg-rose-400/10 p-5 text-sm text-rose-200">
                      {error}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="border-t border-white/8 px-4 py-4">
                <div className="mx-auto max-w-4xl rounded-[22px] bg-black/25 p-3">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Ask Sakha to do anything..."
                    className="min-h-28 w-full resize-none border-0 bg-transparent text-base leading-7 text-white outline-none placeholder:text-slate-500"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-sm text-slate-500">Enter a task, coding request, PPT outline, Excel help, or dashboard request.</p>
                    <button
                      onClick={runPrompt}
                      disabled={loading}
                      className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {loading ? "Running..." : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="grid flex-1 gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-white/8 lg:border-b-0 lg:border-r lg:border-white/8 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <select
                    value={codeLanguage}
                    onChange={(event) => setCodeLanguage(event.target.value as "javascript" | "python")}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                  >
                    <option value="javascript">JavaScript</option>
                    <option value="python">Python</option>
                  </select>
                  <button
                    onClick={runCode}
                    disabled={codeLoading}
                    className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {codeLoading ? "Running..." : "Run code"}
                  </button>
                </div>
                <textarea
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="min-h-[420px] w-full resize-none rounded-[18px] border border-white/8 bg-black/30 p-4 font-mono text-sm leading-7 text-slate-100 outline-none"
                />
              </div>
              <div className="p-4">
                <div className="rounded-[18px] bg-black/30 p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Output</p>
                  <pre className="mt-3 min-h-[420px] whitespace-pre-wrap font-mono text-sm leading-7 text-slate-100">
                    {codeOutput || "Run code to see the output here."}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
