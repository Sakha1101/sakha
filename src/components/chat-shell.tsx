"use client";

import { useMemo, useState } from "react";

import { AppState, ProviderChoice } from "@/lib/types";

type Props = {
  initialState: AppState;
};

export function ChatShell({ initialState }: Props) {
  const [state, setState] = useState(initialState);
  const [providerId, setProviderId] = useState<ProviderChoice>("auto");
  const [prompt, setPrompt] = useState(
    "Create a practical plan for building my personal AI business assistant using free-first tools.",
  );
  const [answer, setAnswer] = useState("");
  const [resolvedProvider, setResolvedProvider] = useState("Auto routing enabled");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeProvider = useMemo(() => {
    if (providerId === "auto") {
      return null;
    }

    return state.providers.find((provider) => provider.id === providerId) ?? state.providers[0];
  }, [providerId, state.providers]);

  async function runPrompt() {
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
        throw new Error(data.error || "Agent request failed.");
      }

      setAnswer(data.message || "");
      setResolvedProvider(data.resolvedProvider || "Auto routing enabled");
      if (data.state) {
        setState(data.state);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden px-4 py-4 text-white md:px-6 md:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col gap-4 lg:grid lg:grid-cols-[1.2fr_0.85fr]">
        <section className="glass-strong relative overflow-hidden rounded-[32px] p-6 md:p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(214,255,87,0.16),_transparent_24%),radial-gradient(circle_at_25%_20%,_rgba(107,226,255,0.18),_transparent_22%)]" />
          <div className="relative z-10 flex h-full flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <p className="mb-3 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.28em] text-lime-200">
                  Sakha Personal Agent
                </p>
                <h1 className="max-w-3xl text-4xl font-semibold leading-none tracking-[-0.05em] md:text-6xl">
                  Sakha chooses the best engine, remembers your context, and follows you across devices.
                </h1>
              </div>
              <div className="glass rounded-[24px] px-4 py-3 text-sm text-slate-200">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Routing status</p>
                <p className="mt-1 font-medium text-white">{providerId === "auto" ? resolvedProvider : activeProvider?.label}</p>
                <p className="mt-1 text-slate-400">
                  Storage: {state.storageMode === "google-drive" ? "Google Drive sync" : "Local file mode"}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[28px] border border-white/8 bg-black/20 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-400">Command deck</p>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  className="mt-4 min-h-56 w-full resize-none border-0 bg-transparent text-base leading-7 text-white outline-none"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <select
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value as ProviderChoice)}
                    className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                  >
                    <option value="auto">Auto route best source</option>
                    {state.providers.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={runPrompt}
                    disabled={loading}
                    className="rounded-full bg-lime-300 px-5 py-2.5 font-medium text-slate-950 transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {loading ? "Running..." : "Run Sakha"}
                  </button>
                  <span className="text-sm text-slate-400">
                    Laptop-hosted sessions can use local tools. Android uses shared cloud memory.
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-between rounded-[28px] border border-white/8 bg-white/[0.03] p-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400">What this build now supports</p>
                  <ul className="mt-4 space-y-3 text-sm leading-6 text-slate-200">
                    <li>Auto-routing between available providers based on the task</li>
                    <li>Optional Google Drive hidden-app storage for memory and tasks</li>
                    <li>Installable PWA shell for Android and laptop access</li>
                    <li>Guarded local actions when Sakha runs on your laptop</li>
                    <li>Module registry for future web, browser, and workflow plugins</li>
                  </ul>
                </div>
                <div className="mt-6 rounded-[20px] bg-black/25 p-4 text-sm leading-6 text-slate-300">
                  <p className="font-medium text-white">Reality check</p>
                  <p className="mt-2">
                    Sakha can learn from saved memory and new modules, but it should not silently rewrite itself or scrape the web forever without controls. We will grow it with guarded upgrades.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {state.providers.map((provider) => (
                <article key={provider.id} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{provider.id}</p>
                  <h2 className="mt-2 text-lg font-medium text-white">{provider.label}</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{provider.baseUrl}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">
                    {provider.status === "configured" ? "configured" : `missing ${provider.apiKeyEnv}`}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="glass rounded-[28px] p-5">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Latest answer</p>
              <p className="text-sm text-slate-500">Chosen source: {resolvedProvider}</p>
            </div>
            <div className="mt-4 min-h-52 whitespace-pre-wrap rounded-[22px] bg-black/25 p-4 text-sm leading-7 text-slate-100">
              {error ? <span className="text-rose-300">{error}</span> : answer || "Run a task to see Sakha's output here."}
            </div>
          </div>

          <div className="glass rounded-[28px] p-5">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Recent tasks</p>
              <span className="text-sm text-slate-500">{state.tasks.length} saved</span>
            </div>
            <div className="mt-4 space-y-3">
              {state.tasks.map((task) => (
                <div key={task.id} className="rounded-[22px] border border-white/8 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-sm font-medium text-white">{task.title}</h3>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{task.provider}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{task.instruction}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="glass rounded-[28px] p-5">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Memory + modules</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {state.memory.slice(0, 4).map((item) => (
                <div key={item.id} className="rounded-[20px] border border-white/8 bg-black/20 p-4">
                  <p className="text-sm font-medium text-white">{item.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{item.content}</p>
                </div>
              ))}
              {state.modules.slice(0, 4).map((module) => (
                <div key={module.id} className="rounded-[20px] border border-lime-300/15 bg-lime-300/[0.04] p-4">
                  <p className="text-sm font-medium text-white">{module.name}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{module.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
