"use client";

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppState } from "@/lib/types";

type Props = {
  initialState: AppState;
};

type TabId = "chat" | "data" | "code";
type CodeLanguage = "javascript" | "python" | "sql" | "dax";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

type DataTable = {
  name: string;
  headers: string[];
  rows: Record<string, unknown>[];
};

type AttachmentItem = {
  id: string;
  name: string;
  type: string;
  sizeLabel: string;
  kind: "image" | "table" | "text" | "file";
  previewUrl?: string;
  textSample?: string;
  table?: DataTable;
};

declare global {
  interface Window {
    alasql?: {
      tables: Record<string, { data: Record<string, unknown>[] }>;
      (query: string): unknown;
    };
  }
}

const starterPrompt = "Help me learn data analysis. I want step-by-step help and practical examples.";
const jsStarter = 'console.log("Hello from Sakha");';
const pyStarter = 'print("Hello from Sakha")';
const sqlStarter = "SELECT * FROM current_data LIMIT 10;";
const daxStarter = "Total Sales = SUM(Sales[Amount])";

export function ChatShell({ initialState }: Props) {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<TabId>("chat");
  const [prompt, setPrompt] = useState(starterPrompt);
  const [answer, setAnswer] = useState("");
  const [resolvedProvider, setResolvedProvider] = useState("Ready");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [sqlReady, setSqlReady] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [activeDataset, setActiveDataset] = useState<string>("");
  const [sqlQuery, setSqlQuery] = useState(sqlStarter);
  const [sqlOutput, setSqlOutput] = useState<string>("");
  const [sqlPreview, setSqlPreview] = useState<Record<string, unknown>[]>([]);
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>("javascript");
  const [code, setCode] = useState(jsStarter);
  const [codeOutput, setCodeOutput] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const datasets = useMemo(
    () => attachments.filter((item) => item.kind === "table" && item.table).map((item) => item.table as DataTable),
    [attachments],
  );

  useEffect(() => {
    if (window.alasql) {
      setSqlReady(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "/vendor/alasql.min.js";
    script.async = true;
    script.onload = () => setSqlReady(true);
    document.body.appendChild(script);

    return () => {
      script.remove();
    };
  }, []);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (!activeDataset && datasets[0]) {
      setActiveDataset(datasets[0].name);
    }
  }, [activeDataset, datasets]);

  useEffect(() => {
    if (!window.alasql) {
      return;
    }

    for (const dataset of datasets) {
      const safeName = sanitizeName(dataset.name);
      window.alasql(`DROP TABLE IF EXISTS ${safeName}`);
      window.alasql(`CREATE TABLE ${safeName}`);
      window.alasql.tables[safeName].data = dataset.rows;
    }

    if (datasets[0]) {
      window.alasql("DROP TABLE IF EXISTS current_data");
      window.alasql("CREATE TABLE current_data");
      window.alasql.tables.current_data.data = (datasets.find((item) => item.name === activeDataset) ?? datasets[0]).rows;
    }
  }, [datasets, activeDataset]);

  useEffect(() => {
    if (codeLanguage === "javascript" && !code.trim()) setCode(jsStarter);
    if (codeLanguage === "python" && !code.trim()) setCode(pyStarter);
    if (codeLanguage === "sql" && !code.trim()) setCode(sqlStarter);
    if (codeLanguage === "dax" && !code.trim()) setCode(daxStarter);
  }, [codeLanguage, code]);

  async function runPrompt() {
    if (!prompt.trim()) return;

    setLoading(true);
    setError("");

    try {
      const message = [prompt.trim(), buildAttachmentContext(attachments)].filter(Boolean).join("\n\n");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, providerId: "auto" }),
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
      if (data.state) setState(data.state);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function runCode() {
    if (codeLanguage === "sql") {
      runSql(code);
      return;
    }

    if (codeLanguage === "dax") {
      setCodeOutput([
        "DAX practice mode",
        "",
        "Your formula is saved in the editor.",
        "To evaluate DAX fully, Sakha needs a Power BI model context.",
        "Use chat to ask Sakha to review, simplify, or explain this DAX formula.",
      ].join("\n"));
      return;
    }

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

  function runSql(query: string) {
    if (!window.alasql) {
      setSqlOutput("SQL engine is still loading. Try again in a moment.");
      setSqlPreview([]);
      setTab("data");
      return;
    }

    try {
      const result = window.alasql(query) as Record<string, unknown>[] | number | string;
      if (Array.isArray(result)) {
        setSqlPreview(result.slice(0, 20));
        setSqlOutput(`Returned ${result.length} row(s).`);
      } else {
        setSqlPreview([]);
        setSqlOutput(String(result));
      }
      setTab("data");
    } catch (caughtError) {
      setSqlPreview([]);
      setSqlOutput(caughtError instanceof Error ? caughtError.message : "SQL failed.");
      setTab("data");
    }
  }

  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
      return;
    }

    setError("Use Chrome or Edge, then choose Install app from the browser menu if the install prompt is not available.");
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;

    const nextItems = await Promise.all(Array.from(files).map(parseFile));
    const merged = [...attachments, ...nextItems];
    setAttachments(merged);
    const firstTable = nextItems.find((item) => item.table)?.table;
    if (firstTable) {
      setActiveDataset(firstTable.name);
      setTab("data");
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function downloadText(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function downloadCsv() {
    if (!sqlPreview.length) return;
    const csv = Papa.unparse(sqlPreview);
    downloadText("sakha-sql-result.csv", csv);
  }

  const selectedDataset = datasets.find((item) => item.name === activeDataset) ?? datasets[0];
  const recentTasks = state.tasks.slice(0, 5);

  return (
    <main className="min-h-screen bg-transparent px-3 py-3 text-white md:px-4 md:py-4">
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
        accept="image/*,.csv,.xlsx,.xls,.pdf,.ppt,.pptx,.txt,.json,.sql,.doc,.docx"
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <div className="mx-auto grid min-h-[calc(100vh-1.5rem)] max-w-7xl gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="glass flex flex-col rounded-[22px] p-3">
          <div className="rounded-[16px] bg-white/4 p-3">
            <p className="text-[11px] uppercase tracking-[0.28em] text-slate-400">Sakha</p>
            <p className="mt-2 text-sm text-slate-200">All-in-one workspace</p>
          </div>

          <div className="mt-3 grid gap-2">
            {[
              ["chat", "Chat"],
              ["data", "Data Lab"],
              ["code", "Code"],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setTab(value as TabId)}
                className={`rounded-[14px] px-3 py-3 text-left text-sm transition ${tab === value ? "bg-lime-300 text-slate-950" : "bg-white/4 text-slate-100 hover:bg-white/8"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-2">
            <button
              onClick={() => uploadRef.current?.click()}
              className="rounded-[14px] bg-white/4 px-3 py-3 text-left text-sm text-slate-100 hover:bg-white/8"
            >
              Attach files
            </button>
            <button
              onClick={() => cameraRef.current?.click()}
              className="rounded-[14px] bg-white/4 px-3 py-3 text-left text-sm text-slate-100 hover:bg-white/8"
            >
              Camera upload
            </button>
            <button
              onClick={installApp}
              className="rounded-[14px] bg-white/4 px-3 py-3 text-left text-sm text-slate-100 hover:bg-white/8"
            >
              Install app
            </button>
          </div>

          <div className="mt-4 rounded-[16px] bg-black/25 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Storage</p>
            <p className="mt-2 text-sm text-white">{state.storageMode === "google-drive" ? "Google Drive" : "Local"}</p>
            <p className="mt-2 text-xs text-slate-400">Google login and Drive sync need backend OAuth setup, which we can wire next.</p>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-auto rounded-[16px] bg-black/20 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Recent tasks</p>
            <div className="mt-3 space-y-2">
              {recentTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => {
                    setTab("chat");
                    setPrompt(task.instruction);
                  }}
                  className="w-full rounded-[12px] bg-white/4 px-3 py-3 text-left text-sm text-slate-100 hover:bg-white/8"
                >
                  <div className="truncate font-medium text-white">{task.title}</div>
                  <div className="mt-1 text-slate-400">{task.provider}</div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="glass-strong flex min-h-[76vh] flex-col rounded-[22px] overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
            <div>
              <h1 className="text-lg font-medium text-white">{tab === "chat" ? "Sakha" : tab === "data" ? "Data Lab" : "Code Studio"}</h1>
              <p className="text-sm text-slate-400">
                {tab === "chat"
                  ? "Ask, attach, learn, practice, and generate from one workspace."
                  : tab === "data"
                    ? "Work with uploaded CSV/XLSX files, run SQL, preview rows, and export results."
                    : "Run JavaScript or Python on your laptop, practice SQL, and draft DAX formulas."}
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-sm text-slate-300">
              <span className="h-2 w-2 rounded-full bg-lime-300" />
              {resolvedProvider}
            </div>
          </header>

          {tab === "chat" ? (
            <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-h-0 flex-col">
                <div className="flex-1 overflow-auto px-4 py-4">
                  {answer ? (
                    <div className="rounded-[18px] bg-black/25 p-5 text-sm leading-7 whitespace-pre-wrap text-slate-100">
                      {answer}
                    </div>
                  ) : (
                    <div className="rounded-[18px] border border-dashed border-white/10 bg-black/20 p-5 text-sm leading-7 text-slate-400">
                      Start with a question, upload files, or ask Sakha to teach you data analysis, review code, outline a PPT, explain SQL, or plan a dashboard.
                    </div>
                  )}

                  {error ? (
                    <div className="mt-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">
                      {error}
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-white/8 px-4 py-4">
                  <div className="rounded-[20px] bg-black/25 p-3">
                    <textarea
                      value={prompt}
                      onChange={(event) => setPrompt(event.target.value)}
                      placeholder="Ask Sakha anything..."
                      className="min-h-28 w-full resize-none border-0 bg-transparent text-base leading-7 text-white outline-none placeholder:text-slate-500"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => uploadRef.current?.click()} className="rounded-full bg-white/6 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                          Attach
                        </button>
                        <button onClick={() => cameraRef.current?.click()} className="rounded-full bg-white/6 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                          Camera
                        </button>
                        {answer ? (
                          <button onClick={() => downloadText("sakha-response.txt", answer)} className="rounded-full bg-white/6 px-3 py-2 text-sm text-slate-200 hover:bg-white/10">
                            Download
                          </button>
                        ) : null}
                      </div>
                      <button
                        onClick={runPrompt}
                        disabled={loading}
                        className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-lime-200 disabled:opacity-70"
                      >
                        {loading ? "Running..." : "Send"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/8 lg:border-l lg:border-t-0 lg:border-white/8 p-4">
                <div className="rounded-[18px] bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Attachments</p>
                  <div className="mt-3 space-y-3">
                    {attachments.length ? (
                      attachments.map((item) => (
                        <div key={item.id} className="rounded-[14px] bg-white/4 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-white">{item.name}</div>
                              <div className="mt-1 text-xs text-slate-400">{item.kind} · {item.sizeLabel}</div>
                            </div>
                            <button onClick={() => removeAttachment(item.id)} className="text-xs text-slate-400 hover:text-white">Remove</button>
                          </div>
                          {item.previewUrl ? <img src={item.previewUrl} alt={item.name} className="mt-3 h-28 w-full rounded-[12px] object-cover" /> : null}
                          {item.table ? <p className="mt-2 text-xs text-slate-400">{item.table.rows.length} rows · {item.table.headers.length} columns</p> : null}
                          {item.textSample ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{item.textSample}</p> : null}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[14px] border border-dashed border-white/10 p-4 text-sm text-slate-400">
                        Upload CSV, Excel, images, PDF, PPT, text, SQL, JSON, and other files here.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "data" ? (
            <div className="grid flex-1 gap-0 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div className="border-b border-white/8 p-4 lg:border-b-0 lg:border-r lg:border-white/8">
                <div className="rounded-[18px] bg-black/20 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Datasets</p>
                  <div className="mt-3 space-y-2">
                    {datasets.length ? datasets.map((dataset) => (
                      <button
                        key={dataset.name}
                        onClick={() => setActiveDataset(dataset.name)}
                        className={`w-full rounded-[12px] px-3 py-3 text-left text-sm ${activeDataset === dataset.name ? "bg-lime-300 text-slate-950" : "bg-white/4 text-slate-100 hover:bg-white/8"}`}
                      >
                        <div className="truncate font-medium">{dataset.name}</div>
                        <div className={`mt-1 text-xs ${activeDataset === dataset.name ? "text-slate-800" : "text-slate-400"}`}>{dataset.rows.length} rows</div>
                      </button>
                    )) : <div className="rounded-[12px] border border-dashed border-white/10 p-4 text-sm text-slate-400">Upload CSV or Excel to start.</div>}
                  </div>
                </div>
              </div>

              <div className="grid min-h-0 lg:grid-rows-[auto_minmax(0,1fr)]">
                <div className="border-b border-white/8 p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <textarea
                      value={sqlQuery}
                      onChange={(event) => setSqlQuery(event.target.value)}
                      className="min-h-28 w-full resize-none rounded-[18px] border border-white/8 bg-black/25 p-4 font-mono text-sm leading-7 text-slate-100 outline-none"
                    />
                    <div className="flex flex-col gap-2">
                      <button onClick={() => runSql(sqlQuery)} className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-lime-200">Run SQL</button>
                      <button onClick={downloadCsv} className="rounded-full bg-white/6 px-5 py-2.5 text-sm text-slate-100 hover:bg-white/10">Download CSV</button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Active table is available as `current_data`. Uploaded datasets are also available by sanitized table name.</p>
                  {!sqlReady ? <p className="mt-2 text-xs text-slate-500">Loading SQL engine...</p> : null}
                </div>

                <div className="grid min-h-0 gap-0 lg:grid-cols-[1.1fr_0.9fr]">
                  <div className="border-b border-white/8 p-4 lg:border-b-0 lg:border-r lg:border-white/8">
                    <div className="rounded-[18px] bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Preview</p>
                        <p className="text-xs text-slate-500">{selectedDataset ? selectedDataset.name : "No dataset"}</p>
                      </div>
                      <div className="mt-3 max-h-[420px] overflow-auto rounded-[14px] border border-white/8">
                        {selectedDataset ? (
                          <table className="min-w-full text-left text-sm text-slate-200">
                            <thead className="bg-white/6 text-slate-400">
                              <tr>
                                {selectedDataset.headers.slice(0, 8).map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {selectedDataset.rows.slice(0, 10).map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-t border-white/6">
                                  {selectedDataset.headers.slice(0, 8).map((header) => <td key={header} className="px-3 py-2 text-slate-300">{String(row[header] ?? "")}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="p-4 text-sm text-slate-400">Upload data to preview rows here.</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="rounded-[18px] bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Query result</p>
                      <p className="mt-3 text-sm text-slate-300">{sqlOutput || "Run SQL to see the result here."}</p>
                      {sqlPreview.length ? (
                        <div className="mt-3 max-h-[320px] overflow-auto rounded-[14px] border border-white/8">
                          <table className="min-w-full text-left text-sm text-slate-200">
                            <thead className="bg-white/6 text-slate-400">
                              <tr>
                                {Object.keys(sqlPreview[0]).map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {sqlPreview.map((row, index) => (
                                <tr key={index} className="border-t border-white/6">
                                  {Object.keys(sqlPreview[0]).map((header) => <td key={header} className="px-3 py-2 text-slate-300">{String(row[header] ?? "")}</td>)}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "code" ? (
            <div className="grid flex-1 gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-white/8 p-4 lg:border-b-0 lg:border-r lg:border-white/8">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {(["javascript", "python", "sql", "dax"] as CodeLanguage[]).map((language) => (
                    <button
                      key={language}
                      onClick={() => {
                        setCodeLanguage(language);
                        setCode(language === "javascript" ? jsStarter : language === "python" ? pyStarter : language === "sql" ? sqlStarter : daxStarter);
                      }}
                      className={`rounded-full px-4 py-2 text-sm ${codeLanguage === language ? "bg-lime-300 text-slate-950" : "bg-white/6 text-slate-100 hover:bg-white/10"}`}
                    >
                      {language.toUpperCase()}
                    </button>
                  ))}
                </div>
                <textarea
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="min-h-[460px] w-full resize-none rounded-[18px] border border-white/8 bg-black/25 p-4 font-mono text-sm leading-7 text-slate-100 outline-none"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button onClick={runCode} disabled={codeLoading} className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-lime-200 disabled:opacity-70">
                    {codeLoading ? "Running..." : codeLanguage === "sql" ? "Run SQL" : "Run code"}
                  </button>
                  <button onClick={() => downloadText(codeLanguage === "sql" ? "sakha-query.sql" : `sakha.${codeLanguage === "python" ? "py" : codeLanguage === "dax" ? "dax" : "js"}`, code)} className="rounded-full bg-white/6 px-5 py-2.5 text-sm text-slate-100 hover:bg-white/10">
                    Download
                  </button>
                </div>
              </div>
              <div className="p-4">
                <div className="rounded-[18px] bg-black/25 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Output</p>
                  <pre className="mt-3 min-h-[460px] whitespace-pre-wrap font-mono text-sm leading-7 text-slate-100">{codeOutput || "Run code to see the output here."}</pre>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function sanitizeName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_") || "dataset";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function parseFile(file: File): Promise<AttachmentItem> {
  const id = crypto.randomUUID();
  const base = {
    id,
    name: file.name,
    type: file.type || "unknown",
    sizeLabel: formatSize(file.size),
  };

  if (file.type.startsWith("image/")) {
    return {
      ...base,
      kind: "image",
      previewUrl: URL.createObjectURL(file),
    };
  }

  if (file.name.toLowerCase().endsWith(".csv")) {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
    });
    const headers = parsed.meta.fields ?? [];
    const rows = parsed.data.filter((row) => Object.keys(row).length);
    return {
      ...base,
      kind: "table",
      table: {
        name: sanitizeName(file.name),
        headers,
        rows,
      },
    };
  }

  if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheet];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return {
      ...base,
      kind: "table",
      table: {
        name: sanitizeName(file.name),
        headers,
        rows,
      },
    };
  }

  if (
    file.type.startsWith("text/") ||
    file.name.toLowerCase().endsWith(".json") ||
    file.name.toLowerCase().endsWith(".sql")
  ) {
    const text = await file.text();
    return {
      ...base,
      kind: "text",
      textSample: text.slice(0, 300),
    };
  }

  return {
    ...base,
    kind: "file",
  };
}

function buildAttachmentContext(items: AttachmentItem[]) {
  if (!items.length) return "";

  const lines = items.map((item) => {
    if (item.table) {
      return `Attached dataset ${item.name}: ${item.table.rows.length} rows, columns: ${item.table.headers.join(", ")}`;
    }
    if (item.textSample) {
      return `Attached text file ${item.name}: sample -> ${item.textSample.replace(/\s+/g, " ").slice(0, 160)}`;
    }
    if (item.kind === "image") {
      return `Attached image ${item.name}`;
    }
    return `Attached file ${item.name}`;
  });

  return `Attachment summary:\n${lines.join("\n")}`;
}
