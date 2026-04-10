"use client";

import Image from "next/image";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppState, ProviderId } from "@/lib/types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend);

type Props = {
  initialState: AppState;
};

type WorkspaceTab = "chat" | "practice";
type CodeLanguage = "javascript" | "python" | "sql" | "dax";
type ChartKind = "bar" | "line";
type RuntimeMode = "browser" | "laptop";
type ConnectionProvider = Exclude<ProviderId, "ollama">;

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
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

type PyodideLike = {
  loadPackage: (packages: string[] | string) => Promise<void>;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: {
    set: (name: string, value: unknown) => void;
    get: (name: string) => unknown;
  };
  setStdout: (opts: { batched: (msg: string) => void }) => void;
  setStderr: (opts: { batched: (msg: string) => void }) => void;
};

declare global {
  interface Window {
    alasql?: {
      tables: Record<string, { data: Record<string, unknown>[] }>;
      (query: string): unknown;
    };
    loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideLike>;
  }
}

const starterPrompt = "Teach me data analysis step by step and help me practice with uploaded files.";
const jsStarter = `const totals = rows.map((row) => Number(row.Sales ?? 0));
const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
console.log("Average sales:", avg.toFixed(2));`;
const pyStarter = `import pandas as pd
import numpy as np

df = pd.DataFrame(rows)
print(df.head())
print(df.describe(include="all"))`;
const sqlStarter = "SELECT Region, SUM(Sales) AS TotalSales FROM current_data GROUP BY Region ORDER BY TotalSales DESC;";
const daxStarter = "Total Sales = SUM(current_data[Sales])";
const challengePrompts = [
  "Give me a SQL interview question with a small dataset and then check my answer.",
  "Act like a data analyst interviewer and ask me a pandas problem.",
  "Give me a DAX practice task and explain the correct measure after I answer.",
];
const providerOptions: Array<{ id: ConnectionProvider; label: string; modelPlaceholder: string }> = [
  { id: "openai", label: "OpenAI", modelPlaceholder: "gpt-4.1-mini or another API model" },
  { id: "openrouter", label: "OpenRouter", modelPlaceholder: "openai/gpt-4.1-mini or a free model" },
  { id: "huggingface", label: "Hugging Face", modelPlaceholder: "openai/gpt-oss-20b or your router model" },
];

export function ChatShell({ initialState }: Props) {
  const [state, setState] = useState(initialState);
  const [tab, setTab] = useState<WorkspaceTab>("chat");
  const [prompt, setPrompt] = useState(starterPrompt);
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [liveProvider, setLiveProvider] = useState<ConnectionProvider>("openrouter");
  const [liveApiKey, setLiveApiKey] = useState("");
  const [liveModel, setLiveModel] = useState("");
  const [pythonReady, setPythonReady] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [activeDataset, setActiveDataset] = useState<string>("");
  const [codeLanguage, setCodeLanguage] = useState<CodeLanguage>("sql");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("browser");
  const [code, setCode] = useState(sqlStarter);
  const [codeOutput, setCodeOutput] = useState("");
  const [codeAdvice, setCodeAdvice] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [resultRows, setResultRows] = useState<Record<string, unknown>[]>([]);
  const [chartKind, setChartKind] = useState<ChartKind>("bar");
  const [chartX, setChartX] = useState("");
  const [chartY, setChartY] = useState("");
  const [pythonPlot, setPythonPlot] = useState<string | null>(null);
  const [daxValue, setDaxValue] = useState("");
  const chatUploadRef = useRef<HTMLInputElement | null>(null);
  const practiceUploadRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const pyodideRef = useRef<PyodideLike | null>(null);

  const datasets = useMemo(
    () => attachments.filter((item) => item.kind === "table" && item.table).map((item) => item.table as DataTable),
    [attachments],
  );

  const selectedDataset = datasets.find((item) => item.name === activeDataset) ?? datasets[0];
  const workingRows = useMemo(
    () => (resultRows.length ? resultRows : selectedDataset?.rows ?? []),
    [resultRows, selectedDataset],
  );
  const workingHeaders = useMemo(
    () => (workingRows.length ? Object.keys(workingRows[0]) : selectedDataset?.headers ?? []),
    [workingRows, selectedDataset],
  );
  const numericHeaders = workingHeaders.filter((header) => workingRows.some((row) => Number.isFinite(Number(row[header]))));
  const categoricalHeaders = workingHeaders.filter((header) => !numericHeaders.includes(header));
  const recentTasks = state.tasks.slice(0, 4);
  const chartData = buildChartData(workingRows, chartX, chartY);
  const liveConnectionReady = Boolean(liveApiKey.trim() && liveModel.trim());
  const datasetProfile = useMemo(() => {
    if (!selectedDataset) return null;
    const sample = selectedDataset.rows.slice(0, 100);

    return {
      rows: selectedDataset.rows.length,
      columns: selectedDataset.headers.length,
      numericColumns: selectedDataset.headers.filter((header) =>
        selectedDataset.rows.some((row) => Number.isFinite(Number(row[header]))),
      ),
      missingByColumn: selectedDataset.headers.map((header) => ({
        header,
        missing: sample.filter((row) => row[header] === "" || row[header] === null || row[header] === undefined).length,
      })),
    };
  }, [selectedDataset]);

  useEffect(() => {
    if (window.alasql) return;

    const script = document.createElement("script");
    script.src = "/vendor/alasql.min.js";
    script.async = true;
    document.body.appendChild(script);

    return () => script.remove();
  }, []);

  useEffect(() => {
    if (!activeDataset && datasets[0]) {
      setActiveDataset(datasets[0].name);
    }
  }, [activeDataset, datasets]);

  useEffect(() => {
    const saved = window.localStorage.getItem("sakha-live-provider");
    if (saved) setLiveProvider(saved as ConnectionProvider);
    setLiveApiKey(window.localStorage.getItem("sakha-live-api-key") || "");
    setLiveModel(window.localStorage.getItem("sakha-live-model") || "");
  }, []);

  useEffect(() => {
    if (!window.alasql) return;

    for (const dataset of datasets) {
      const safeName = sanitizeName(dataset.name);
      window.alasql(`DROP TABLE IF EXISTS ${safeName}`);
      window.alasql(`CREATE TABLE ${safeName}`);
      window.alasql.tables[safeName].data = dataset.rows;
    }

    if (selectedDataset) {
      window.alasql("DROP TABLE IF EXISTS current_data");
      window.alasql("CREATE TABLE current_data");
      window.alasql.tables.current_data.data = selectedDataset.rows;
    }
  }, [datasets, selectedDataset]);

  useEffect(() => {
    if (!chartX && (categoricalHeaders[0] || workingHeaders[0])) {
      setChartX(categoricalHeaders[0] || workingHeaders[0]);
    }
    if (!chartY && numericHeaders[0]) {
      setChartY(numericHeaders[0]);
    }
  }, [chartX, chartY, categoricalHeaders, numericHeaders, workingHeaders]);

  async function ensurePythonReady() {
    if (pyodideRef.current) {
      setPythonReady(true);
      return pyodideRef.current;
    }

    if (!window.loadPyodide) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Python runtime failed to load."));
        document.body.appendChild(script);
      });
    }

    if (!window.loadPyodide) {
      throw new Error("Python runtime is unavailable.");
    }

    const pyodide = await window.loadPyodide({
      indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/",
    });

    await pyodide.loadPackage(["numpy", "pandas", "matplotlib"]);
    pyodideRef.current = pyodide;
    setPythonReady(true);
    return pyodide;
  }

  async function runPrompt() {
    const text = prompt.trim();
    if (!text || loading) return;

    setLoading(true);
    setError("");
    setPrompt("");
    setChatTurns((current) => [...current, { id: crypto.randomUUID(), role: "user", content: text }]);

    try {
      const message = [text, buildAttachmentContext(attachments)].filter(Boolean).join("\n\n");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          providerId: "auto",
          runtimeProvider: liveConnectionReady
            ? {
                id: liveProvider,
                apiKey: liveApiKey.trim(),
                model: liveModel.trim(),
              }
            : undefined,
        }),
      });

      const data = (await response.json()) as {
        message?: string;
        error?: string;
        state?: AppState;
      };

      if (!response.ok) {
        throw new Error(data.error || "Request failed.");
      }

      setChatTurns((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "assistant", content: data.message || "" },
      ]);
      if (data.state) setState(data.state);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unknown error");
      setPrompt(text);
    } finally {
      setLoading(false);
      setMenuOpen(false);
    }
  }

  async function runPractice() {
    setCodeLoading(true);
    setCodeOutput("");
    setCodeAdvice("");
    setPythonPlot(null);
    setDaxValue("");

    try {
      if (codeLanguage === "sql") {
        runSql(code);
        setCodeAdvice(explainNextSteps("sql", code, codeOutput || "", selectedDataset));
        return;
      }

      if (codeLanguage === "dax") {
        const dax = evaluateDaxFormula(code, selectedDataset);
        setDaxValue(dax.value);
        setCodeOutput(`${dax.value}\n\n${dax.explanation}`);
        setCodeAdvice(explainNextSteps("dax", code, dax.explanation, selectedDataset));
        return;
      }

      if (runtimeMode === "laptop") {
        const response = await fetch("/api/code", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            language: codeLanguage === "python" ? "python" : "javascript",
          }),
        });

        const data = (await response.json()) as { output?: string; error?: string };
        if (!response.ok) {
          throw new Error(data.error || "Laptop execution failed.");
        }

        const output = data.output || "Execution finished with no stdout.";
        setCodeOutput(output);
        setCodeAdvice(explainNextSteps(codeLanguage, code, output, selectedDataset));
        return;
      }

      if (codeLanguage === "javascript") {
        const result = runJavaScriptLocally(code, selectedDataset?.rows ?? []);
        setCodeOutput(result.output);
        setCodeAdvice(explainNextSteps("javascript", code, result.output, selectedDataset));
        return;
      }

      const pyodide = await ensurePythonReady();
      const buffer: string[] = [];
      pyodide.setStdout({ batched: (msg) => buffer.push(msg) });
      pyodide.setStderr({ batched: (msg) => buffer.push(msg) });
      pyodide.globals.set("rows_json", JSON.stringify(selectedDataset?.rows ?? []));

      await pyodide.runPythonAsync(
        [
          "import json",
          "import io",
          "import base64",
          "import pandas as pd",
          "import numpy as np",
          "import matplotlib.pyplot as plt",
          "rows = json.loads(rows_json)",
          "df = pd.DataFrame(rows)",
          "plt.close('all')",
          code,
          "_sakha_plot = None",
          "if plt.get_fignums():",
          "    buf = io.BytesIO()",
          "    plt.tight_layout()",
          "    plt.savefig(buf, format='png')",
          "    _sakha_plot = base64.b64encode(buf.getvalue()).decode('utf-8')",
        ].join("\n"),
      );

      const output = buffer.join("\n").trim() || "Python finished with no stdout.";
      const plotValue = pyodide.globals.get("_sakha_plot");
      setCodeOutput(output);
      setCodeAdvice(explainNextSteps("python", code, output, selectedDataset));
      if (plotValue && String(plotValue) !== "None") {
        setPythonPlot(`data:image/png;base64,${String(plotValue)}`);
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Execution failed.";
      setCodeOutput(message);
      setCodeAdvice(explainError(codeLanguage, message));
    } finally {
      setCodeLoading(false);
    }
  }

  function runSql(query: string) {
    if (!window.alasql) {
      const message = "SQL engine is still loading. Try again in a moment.";
      setCodeOutput(message);
      setResultRows([]);
      return;
    }

    try {
      const result = window.alasql(query) as Record<string, unknown>[] | number | string;
      if (Array.isArray(result)) {
        setResultRows(result.slice(0, 100));
        setCodeOutput(`Returned ${result.length} row(s).`);
        setCodeAdvice(explainNextSteps("sql", query, `Returned ${result.length} row(s).`, selectedDataset));
      } else {
        setResultRows([]);
        setCodeOutput(String(result));
        setCodeAdvice(explainNextSteps("sql", query, String(result), selectedDataset));
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "SQL failed.";
      setResultRows([]);
      setCodeOutput(message);
      setCodeAdvice(explainError("sql", message));
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextItems = await Promise.all(Array.from(files).map(parseFile));
    setAttachments((current) => [...current, ...nextItems]);
    const firstTable = nextItems.find((item) => item.table)?.table;
    if (firstTable) {
      setActiveDataset(firstTable.name);
      setTab("practice");
      setResultRows([]);
    }
    setMenuOpen(false);
  }

  function saveConnection() {
    window.localStorage.setItem("sakha-live-provider", liveProvider);
    window.localStorage.setItem("sakha-live-api-key", liveApiKey);
    window.localStorage.setItem("sakha-live-model", liveModel);
    setConnectOpen(false);
  }

  function clearConnection() {
    window.localStorage.removeItem("sakha-live-provider");
    window.localStorage.removeItem("sakha-live-api-key");
    window.localStorage.removeItem("sakha-live-model");
    setLiveApiKey("");
    setLiveModel("");
  }

  function generateSampleDataset() {
    const regions = ["North", "South", "East", "West"];
    const products = ["Laptop", "Phone", "Tablet", "Monitor", "Keyboard"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const channels = ["Online", "Retail", "Partner"];
    const rows = Array.from({ length: 48 }, (_, index) => {
      const sales = 500 + Math.floor(Math.random() * 1800);
      const cost = Math.floor(sales * (0.55 + Math.random() * 0.2));
      return {
        OrderID: `ORD-${Date.now().toString().slice(-5)}-${index + 1}`,
        Region: regions[Math.floor(Math.random() * regions.length)],
        Product: products[Math.floor(Math.random() * products.length)],
        Month: months[Math.floor(Math.random() * months.length)],
        Channel: channels[Math.floor(Math.random() * channels.length)],
        Units: 5 + Math.floor(Math.random() * 45),
        Sales: sales,
        Cost: cost,
        Profit: sales - cost,
      };
    });

    const table: DataTable = {
      name: `sample_sales_${attachments.filter((item) => item.table).length + 1}`,
      headers: Object.keys(rows[0]),
      rows,
    };

    setAttachments((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: `${table.name}.json`,
        type: "application/json",
        sizeLabel: formatSize(JSON.stringify(rows).length),
        kind: "table",
        table,
      },
    ]);
    setActiveDataset(table.name);
    setTab("practice");
    setResultRows([]);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function queueChallenge(promptText: string) {
    setTab("chat");
    setPrompt(promptText);
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void runPrompt();
    }
  }

  function setLanguageAndStarter(language: CodeLanguage) {
    setCodeLanguage(language);
    setResultRows([]);
    setPythonPlot(null);
    setDaxValue("");
    setCodeOutput("");
    setCodeAdvice("");

    if (language === "python") setCode(pyStarter);
    if (language === "sql") setCode(sqlStarter);
    if (language === "dax") setCode(daxStarter);
    if (language === "javascript") setCode(jsStarter);
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

  return (
    <main className="min-h-screen bg-transparent px-3 py-3 text-white md:px-5 md:py-5">
      <input
        ref={chatUploadRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,.csv,.xlsx,.xls,.pdf,.ppt,.pptx,.txt,.json,.sql,.doc,.docx"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <input
        ref={practiceUploadRef}
        type="file"
        multiple
        className="hidden"
        accept=".csv,.xlsx,.xls,.json,.txt,.sql"
        onChange={(event) => void handleFiles(event.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => void handleFiles(event.target.files)}
      />

      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-7xl flex-col overflow-hidden rounded-[28px] border border-white/8 bg-[rgba(6,14,26,0.88)] shadow-[0_24px_80px_rgba(0,0,0,0.42)] backdrop-blur-xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/8 px-4 py-4 md:px-6">
          <div>
            <div className="text-[11px] uppercase tracking-[0.28em] text-slate-500">Sakha</div>
            <h1 className="mt-2 text-2xl font-semibold text-white">Personal AI workspace</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-full bg-white/5 p-1">
              {([
                ["chat", "Chat"],
                ["practice", "Practice"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTab(value)}
                  className={`rounded-full px-4 py-2 text-sm transition ${tab === value ? "bg-lime-300 text-slate-950" : "text-slate-300 hover:bg-white/8"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setConnectOpen((current) => !current)} className="rounded-full bg-white/6 px-4 py-2 text-sm text-slate-100 hover:bg-white/10">
              {liveConnectionReady ? "AI connected" : "Connect AI"}
            </button>
          </div>
        </header>

        {connectOpen ? (
          <div className="border-b border-white/8 bg-black/20 px-4 py-4 md:px-6">
            <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <select value={liveProvider} onChange={(event) => setLiveProvider(event.target.value as ConnectionProvider)} className="rounded-[14px] border border-white/8 bg-black/25 px-3 py-3 text-sm text-white outline-none">
                {providerOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
              <input value={liveApiKey} onChange={(event) => setLiveApiKey(event.target.value)} type="password" placeholder="Paste API key" className="rounded-[14px] border border-white/8 bg-black/25 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500" />
              <input value={liveModel} onChange={(event) => setLiveModel(event.target.value)} placeholder={providerOptions.find((option) => option.id === liveProvider)?.modelPlaceholder} className="rounded-[14px] border border-white/8 bg-black/25 px-3 py-3 text-sm text-white outline-none placeholder:text-slate-500" />
              <div className="flex gap-2">
                <button onClick={saveConnection} className="rounded-full bg-lime-300 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-lime-200">Save</button>
                <button onClick={clearConnection} className="rounded-full bg-white/6 px-4 py-2 text-sm text-slate-100 hover:bg-white/10">Clear</button>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-400">Use your own API key here. ChatGPT subscription alone does not provide API access, but OpenAI API, OpenRouter, or Hugging Face keys will work.</p>
          </div>
        ) : null}

        {tab === "chat" ? (
          <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="flex min-h-0 flex-col">
              <div className="flex-1 overflow-auto px-4 py-4 md:px-6">
                {!liveConnectionReady ? (
                  <div className="mb-4 rounded-[18px] border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
                    Chat is not connected to a live AI model yet. Use `Connect AI` above, save your API key and model, then Sakha will answer live instead of falling back.
                  </div>
                ) : null}
                {chatTurns.length ? (
                  <div className="space-y-4">
                    {chatTurns.map((turn) => (
                      <div key={turn.id} className={`max-w-3xl rounded-[22px] px-4 py-4 text-sm leading-7 ${turn.role === "user" ? "ml-auto bg-lime-300 text-slate-950" : "bg-white/4 text-slate-100"}`}>
                        {turn.content}
                      </div>
                    ))}
                    {loading ? <div className="max-w-3xl rounded-[22px] bg-white/4 px-4 py-4 text-sm text-slate-300">Sakha is thinking...</div> : null}
                  </div>
                ) : (
                  <div className="flex h-full min-h-[360px] flex-col justify-center rounded-[28px] border border-dashed border-white/10 bg-black/15 px-6 py-8">
                    <h2 className="text-3xl font-semibold text-white">Ask anything. Practice anything.</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                      Use Sakha like a cleaner ChatGPT-style workspace. Ask for coding help, dashboards, interview practice, image prompts, PPT outlines, or data analysis guidance.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-2">
                      {challengePrompts.map((item) => (
                        <button key={item} onClick={() => queueChallenge(item)} className="rounded-full bg-white/6 px-4 py-2 text-sm text-slate-200 hover:bg-white/10">
                          {item.includes("SQL") ? "SQL challenge" : item.includes("pandas") ? "Python challenge" : "DAX challenge"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {error ? <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-200">{error}</div> : null}
              </div>

              <div className="border-t border-white/8 px-4 py-4 md:px-6">
                <div className="rounded-[26px] border border-white/8 bg-black/20 p-3">
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    placeholder="Message Sakha"
                    className="min-h-28 w-full resize-none border-0 bg-transparent text-base leading-7 text-white outline-none placeholder:text-slate-500"
                  />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen((current) => !current)}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-white/6 text-xl text-slate-100 hover:bg-white/10"
                        aria-label="Open upload menu"
                      >
                        +
                      </button>
                      {menuOpen ? (
                        <div className="absolute bottom-14 left-0 z-20 w-52 rounded-[18px] border border-white/10 bg-[rgba(8,18,34,0.98)] p-2 shadow-2xl">
                          <button onClick={() => chatUploadRef.current?.click()} className="flex w-full rounded-[14px] px-3 py-3 text-left text-sm text-slate-100 hover:bg-white/8">Upload files</button>
                          <button onClick={() => cameraRef.current?.click()} className="flex w-full rounded-[14px] px-3 py-3 text-left text-sm text-slate-100 hover:bg-white/8">Camera</button>
                        </div>
                      ) : null}
                    </div>
                    <button onClick={() => void runPrompt()} disabled={loading || !prompt.trim()} className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-lime-200 disabled:opacity-60">
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <aside className="border-t border-white/8 p-4 lg:border-l lg:border-t-0 lg:border-white/8 md:p-6">
              <div className="rounded-[22px] bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Attached context</p>
                <div className="mt-4 space-y-3">
                  {attachments.length ? attachments.slice(-5).map((item) => (
                    <div key={item.id} className="rounded-[16px] bg-black/20 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white">{item.name}</div>
                          <div className="mt-1 text-xs text-slate-400">{item.kind} / {item.sizeLabel}</div>
                        </div>
                        <button onClick={() => removeAttachment(item.id)} className="text-xs text-slate-400 hover:text-white">Remove</button>
                      </div>
                      {item.previewUrl ? <Image src={item.previewUrl} alt={item.name} width={480} height={220} className="mt-3 h-24 w-full rounded-[12px] object-cover" unoptimized /> : null}
                      {item.table ? <div className="mt-2 text-xs text-slate-400">{item.table.rows.length} rows / {item.table.headers.length} columns</div> : null}
                      {item.textSample ? <div className="mt-2 line-clamp-3 text-xs leading-5 text-slate-400">{item.textSample}</div> : null}
                    </div>
                  )) : <div className="rounded-[16px] border border-dashed border-white/10 p-4 text-sm text-slate-400">Use the + button to attach files, images, or camera captures.</div>}
                </div>
              </div>

              <div className="mt-4 rounded-[22px] bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Recent tasks</p>
                <div className="mt-4 space-y-2">
                  {recentTasks.map((task) => (
                    <button key={task.id} onClick={() => queueChallenge(task.instruction)} className="w-full rounded-[14px] bg-black/20 px-3 py-3 text-left text-sm text-slate-200 hover:bg-black/30">
                      <div className="truncate font-medium text-white">{task.title}</div>
                      <div className="mt-1 truncate text-slate-400">{task.instruction}</div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="grid flex-1 lg:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="border-b border-white/8 p-4 lg:border-b-0 lg:border-r lg:border-white/8 md:p-6">
              <div>
                <h2 className="text-lg font-medium text-white">Datasets</h2>
                <p className="mt-1 text-sm text-slate-400">Upload multiple files and practice joins, pandas, SQL, and DAX.</p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => practiceUploadRef.current?.click()} className="rounded-full bg-lime-300 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-lime-200">Upload data</button>
                <button onClick={generateSampleDataset} className="rounded-full bg-white/6 px-4 py-2 text-sm text-slate-100 hover:bg-white/10">Generate sample data</button>
              </div>
              <p className="mt-3 text-sm text-slate-400">
                {datasets.length
                  ? `${datasets.length} dataset(s) loaded. Upload multiple files to practice joins and comparisons.`
                  : "Upload CSV, Excel, or JSON datasets. After upload, Sakha will show fields and let you query them."}
              </p>

              <div className="mt-4 space-y-2">
                {datasets.length ? datasets.map((dataset) => (
                  <button
                    key={dataset.name}
                    onClick={() => {
                      setActiveDataset(dataset.name);
                      setResultRows([]);
                    }}
                    className={`w-full rounded-[16px] px-3 py-3 text-left text-sm ${selectedDataset?.name === dataset.name ? "bg-lime-300 text-slate-950" : "bg-white/4 text-slate-100 hover:bg-white/8"}`}
                  >
                    <div className="truncate font-medium">{dataset.name}</div>
                    <div className={`mt-1 text-xs ${selectedDataset?.name === dataset.name ? "text-slate-800" : "text-slate-400"}`}>{dataset.rows.length} rows / {dataset.headers.length} columns</div>
                  </button>
                )) : <div className="rounded-[16px] border border-dashed border-white/10 p-4 text-sm text-slate-400">No dataset yet. Upload a file or generate sample data.</div>}
              </div>

              <div className="mt-5 rounded-[22px] bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Schema</p>
                {datasetProfile ? (
                  <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-[14px] bg-black/20 p-3"><div className="text-xs text-slate-500">Rows</div><div className="mt-1 text-lg text-white">{datasetProfile.rows}</div></div>
                      <div className="rounded-[14px] bg-black/20 p-3"><div className="text-xs text-slate-500">Columns</div><div className="mt-1 text-lg text-white">{datasetProfile.columns}</div></div>
                    </div>
                    <div className="max-h-64 overflow-auto rounded-[16px] bg-black/20 p-3">
                      {selectedDataset?.headers.map((header) => (
                        <div key={header} className="flex items-center justify-between border-b border-white/6 py-2 text-sm last:border-b-0">
                          <span className="truncate text-slate-100">{header}</span>
                          <span className="ml-3 text-xs text-slate-500">{datasetProfile.numericColumns.includes(header) ? "numeric" : "text"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <div className="mt-4 text-sm text-slate-400">Upload data to inspect headers and field types.</div>}
              </div>
            </aside>

            <section className="grid min-h-0 lg:grid-rows-[auto_minmax(0,1fr)]">
              <div className="border-b border-white/8 px-4 py-4 md:px-6">
                <div className="flex flex-wrap items-center gap-2">
                  {(["sql", "python", "dax", "javascript"] as CodeLanguage[]).map((language) => (
                    <button key={language} onClick={() => setLanguageAndStarter(language)} className={`rounded-full px-4 py-2 text-sm ${codeLanguage === language ? "bg-lime-300 text-slate-950" : "bg-white/6 text-slate-100 hover:bg-white/10"}`}>
                      {language.toUpperCase()}
                    </button>
                  ))}
                  {(codeLanguage === "python" || codeLanguage === "javascript") ? (
                    <div className="ml-auto flex items-center gap-2 rounded-full bg-white/5 p-1">
                      {(["browser", "laptop"] as RuntimeMode[]).map((mode) => (
                        <button key={mode} onClick={() => setRuntimeMode(mode)} className={`rounded-full px-3 py-1.5 text-xs ${runtimeMode === mode ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/8"}`}>
                          {mode === "browser" ? "Browser" : "Laptop"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 text-sm text-slate-400">
                  {codeLanguage === "sql"
                    ? "Use current_data for the selected dataset. You can also join uploaded tables using their dataset names."
                    : codeLanguage === "python"
                      ? `Practice pandas, numpy, and matplotlib. ${pythonReady ? "Python runtime is ready." : "Browser mode supports inline visuals after the runtime loads once."}`
                      : codeLanguage === "dax"
                        ? "Practice DAX measures against current_data and see evaluated output immediately."
                        : "Use JavaScript array operations for quick analysis practice."}
                </div>
              </div>

              <div className="grid min-h-0 lg:grid-cols-[1.02fr_0.98fr]">
                <div className="border-b border-white/8 p-4 lg:border-b-0 lg:border-r lg:border-white/8 md:p-6">
                  <textarea
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="min-h-[420px] w-full resize-none rounded-[24px] border border-white/8 bg-black/20 p-4 font-mono text-sm leading-7 text-slate-100 outline-none"
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button onClick={() => void runPractice()} disabled={codeLoading} className="rounded-full bg-lime-300 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-lime-200 disabled:opacity-60">{codeLoading ? "Running..." : "Run"}</button>
                    <button onClick={() => downloadText(codeLanguage === "python" ? "sakha.py" : codeLanguage === "sql" ? "sakha.sql" : codeLanguage === "dax" ? "sakha.dax" : "sakha.js", code)} className="rounded-full bg-white/6 px-5 py-2.5 text-sm text-slate-100 hover:bg-white/10">Download code</button>
                    <button onClick={() => queueChallenge(`Give me a ${codeLanguage.toUpperCase()} interview question based on ${selectedDataset?.name || "a generated dataset"}.`)} className="rounded-full bg-white/6 px-5 py-2.5 text-sm text-slate-100 hover:bg-white/10">Challenge me</button>
                  </div>
                </div>

                <div className="grid min-h-0 lg:grid-rows-[minmax(0,1fr)_auto_auto]">
                  <div className="p-4 md:p-6">
                    <div className="rounded-[24px] bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Output</p>
                        <button onClick={() => downloadText("sakha-output.txt", codeOutput || "")} className="rounded-full bg-white/6 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">Download output</button>
                      </div>
                      <pre className="mt-3 min-h-[180px] whitespace-pre-wrap font-mono text-sm leading-7 text-slate-100">{codeOutput || "Run your query or code to see output here."}</pre>
                      {pythonPlot ? <Image src={pythonPlot} alt="Python plot" width={900} height={520} className="mt-4 max-h-[260px] w-full rounded-[16px] bg-white object-contain" unoptimized /> : null}
                      {codeLanguage === "dax" && daxValue ? <div className="mt-4 rounded-[16px] bg-white/4 p-3 text-sm text-slate-100">Measure value: {daxValue}</div> : null}
                    </div>
                  </div>
                  <div className="border-t border-white/8 px-4 py-4 md:px-6">
                    <div className="rounded-[24px] bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Result grid / chart</p>
                      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                        <div className="max-h-[240px] overflow-auto rounded-[16px] border border-white/8">
                          {workingHeaders.length ? (
                            <table className="min-w-full text-left text-sm text-slate-200">
                              <thead className="bg-white/6 text-slate-400">
                                <tr>{workingHeaders.slice(0, 8).map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr>
                              </thead>
                              <tbody>
                                {workingRows.slice(0, 16).map((row, rowIndex) => (
                                  <tr key={rowIndex} className="border-t border-white/6">
                                    {workingHeaders.slice(0, 8).map((header) => <td key={header} className="px-3 py-2 text-slate-300">{String(row[header] ?? "")}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : <div className="p-4 text-sm text-slate-400">Upload a dataset or run SQL to inspect rows here.</div>}
                        </div>
                        <div className="space-y-2">
                          <select value={chartKind} onChange={(event) => setChartKind(event.target.value as ChartKind)} className="w-full rounded-[14px] border border-white/8 bg-black/25 px-3 py-2 text-sm text-white outline-none">
                            <option value="bar">Bar chart</option>
                            <option value="line">Line chart</option>
                          </select>
                          <select value={chartX} onChange={(event) => setChartX(event.target.value)} className="w-full rounded-[14px] border border-white/8 bg-black/25 px-3 py-2 text-sm text-white outline-none">
                            <option value="">Category field</option>
                            {workingHeaders.map((header) => <option key={header} value={header}>{header}</option>)}
                          </select>
                          <select value={chartY} onChange={(event) => setChartY(event.target.value)} className="w-full rounded-[14px] border border-white/8 bg-black/25 px-3 py-2 text-sm text-white outline-none">
                            <option value="">Numeric field</option>
                            {numericHeaders.map((header) => <option key={header} value={header}>{header}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="mt-4 h-[270px] rounded-[16px] border border-white/8 bg-black/25 p-3">
                        {chartData ? (chartKind === "bar" ? <Bar data={chartData} options={chartOptions} /> : <Line data={chartData} options={chartOptions} />) : <div className="flex h-full items-center justify-center text-sm text-slate-500">Choose a category field and numeric field to draw a chart.</div>}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-white/8 px-4 py-4 md:px-6">
                    <div className="rounded-[24px] bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Coach</p>
                      <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{codeAdvice || "Sakha will review errors, explain output, and suggest a stronger next step after each run."}</div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
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
  const base = {
    id: crypto.randomUUID(),
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
    const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true });
    const rows = parsed.data.filter((row) => Object.keys(row).length);
    return {
      ...base,
      kind: "table",
      table: {
        name: sanitizeName(file.name),
        headers: parsed.meta.fields ?? [],
        rows,
      },
    };
  }

  if (file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls")) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const firstSheet = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], { defval: "" });
    return {
      ...base,
      kind: "table",
      table: {
        name: sanitizeName(file.name),
        headers: rows.length ? Object.keys(rows[0]) : [],
        rows,
      },
    };
  }

  if (file.name.toLowerCase().endsWith(".json")) {
    const text = await file.text();
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed) && parsed.every((row) => typeof row === "object" && row !== null && !Array.isArray(row))) {
        const rows = parsed as Record<string, unknown>[];
        return {
          ...base,
          kind: "table",
          table: {
            name: sanitizeName(file.name),
            headers: rows.length ? Object.keys(rows[0]) : [],
            rows,
          },
        };
      }
    } catch {
      // fall back to text preview below
    }

    return {
      ...base,
      kind: "text",
      textSample: text.slice(0, 400),
    };
  }

  if (file.type.startsWith("text/") || /\.(sql|md|py|js|ts)$/i.test(file.name)) {
    const text = await file.text();
    return {
      ...base,
      kind: "text",
      textSample: text.slice(0, 400),
    };
  }

  return {
    ...base,
    kind: "file",
  };
}

function buildAttachmentContext(items: AttachmentItem[]) {
  if (!items.length) return "";

  return [
    "Attachment summary:",
    ...items.map((item) => {
      if (item.table) {
        return `- ${item.name}: ${item.table.rows.length} rows, columns: ${item.table.headers.join(", ")}`;
      }
      if (item.textSample) {
        return `- ${item.name}: ${item.textSample.replace(/\s+/g, " ").slice(0, 180)}`;
      }
      if (item.kind === "image") {
        return `- ${item.name}: image attachment`;
      }
      return `- ${item.name}: file attachment`;
    }),
  ].join("\n");
}

function buildChartData(rows: Record<string, unknown>[], x: string, y: string) {
  if (!rows.length || !x || !y) return null;

  return {
    labels: rows.slice(0, 20).map((row) => String(row[x] ?? "")),
    datasets: [
      {
        label: y,
        data: rows.slice(0, 20).map((row) => Number(row[y] ?? 0)),
        backgroundColor: "rgba(214,255,87,0.65)",
        borderColor: "rgba(107,226,255,1)",
        borderWidth: 2,
      },
    ],
  };
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: "#e6eef8",
      },
    },
  },
  scales: {
    x: {
      ticks: { color: "#94abc2" },
      grid: { color: "rgba(255,255,255,0.06)" },
    },
    y: {
      ticks: { color: "#94abc2" },
      grid: { color: "rgba(255,255,255,0.06)" },
    },
  },
};

function runJavaScriptLocally(code: string, rows: Record<string, unknown>[]) {
  const logs: string[] = [];
  const consoleProxy = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
  };
  const runner = new Function("rows", "console", `${code}`);
  const result = runner(rows, consoleProxy);
  return {
    output:
      [...logs, result !== undefined ? `Return value: ${String(result)}` : ""].filter(Boolean).join("\n") ||
      "JavaScript finished.",
  };
}

function explainError(language: CodeLanguage, message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("syntax")) {
    return `${language.toUpperCase()} syntax issue detected. Recheck commas, brackets, quotes, and function names.`;
  }
  if (lower.includes("nameerror") || lower.includes("not defined")) {
    return "A variable or function is missing. Define it first or verify the spelling.";
  }
  if (lower.includes("column") || lower.includes("no such") || lower.includes("table")) {
    return "Sakha could not find the field or table you referenced. Check dataset names, headers, and use current_data for the selected table.";
  }
  return "Read the error top to bottom, isolate the failing line, fix the smallest issue first, and rerun.";
}

function explainNextSteps(language: CodeLanguage, code: string, output: string, dataset?: DataTable) {
  const suggestions: string[] = [];

  if (language === "python") {
    suggestions.push("Use df.head(), df.info(), and df.describe() early to understand the dataset.");
    if (!/plot|matplotlib|plt\./i.test(code)) {
      suggestions.push("Try plt.plot(...), plt.bar(...), or df.groupby(...).sum().plot(kind='bar') for a quick visual.");
    }
  }

  if (language === "sql") {
    suggestions.push("Start with SELECT * FROM current_data LIMIT 10 when exploring unfamiliar data.");
    if (!/group by/i.test(code)) {
      suggestions.push("The next useful step is usually GROUP BY with SUM, COUNT, AVG, MIN, or MAX.");
    }
  }

  if (language === "dax") {
    suggestions.push("Build measures in layers: SUM or COUNT first, then CALCULATE filters, then ratios with DIVIDE.");
  }

  if (language === "javascript") {
    suggestions.push("Use map, filter, reduce, sort, and grouped objects for quick data shaping practice.");
  }

  if (dataset) {
    suggestions.push(`Current dataset: ${dataset.name} with ${dataset.rows.length} rows and ${dataset.headers.length} columns.`);
  }

  if (/error|traceback|failed/i.test(output)) {
    suggestions.push(explainError(language, output));
  } else if (language === "dax" && /unsupported/i.test(output.toLowerCase())) {
    suggestions.push('Try patterns like SUM(current_data[Sales]) or CALCULATE(SUM(current_data[Sales]), current_data[Region] = "East").');
  } else {
    suggestions.push(summarizeExecution(language));
  }

  return suggestions.join("\n");
}

function summarizeExecution(language: CodeLanguage) {
  if (language === "python") {
    return "If the output looks right, move from inspection to aggregation, then create a chart or a grouped summary.";
  }
  if (language === "sql") {
    return "If the rows look right, test filtering, grouping, or a join with another uploaded table next.";
  }
  if (language === "dax") {
    return "If the measure value looks right, test the same logic with another column or filter condition.";
  }
  return "If the result is correct, refactor the logic into a reusable function and test another scenario.";
}

function evaluateDaxFormula(code: string, dataset?: DataTable) {
  const formula = code.trim();
  if (!dataset) {
    return {
      value: "No dataset",
      explanation: "Upload or generate a dataset so Sakha can evaluate common DAX measures against current_data.",
    };
  }

  const expression = formula.includes("=") ? formula.split("=").slice(1).join("=").trim() : formula;
  const rows = dataset.rows;

  const sumMatch = expression.match(/^SUM\(([^[]+)\[([^\]]+)\]\)$/i);
  const avgMatch = expression.match(/^AVERAGE\(([^[]+)\[([^\]]+)\]\)$/i);
  const countRowsMatch = expression.match(/^COUNTROWS\(([^)]+)\)$/i);
  const countMatch = expression.match(/^COUNT\(([^[]+)\[([^\]]+)\]\)$/i);
  const distinctMatch = expression.match(/^DISTINCTCOUNT\(([^[]+)\[([^\]]+)\]\)$/i);
  const minMatch = expression.match(/^MIN\(([^[]+)\[([^\]]+)\]\)$/i);
  const maxMatch = expression.match(/^MAX\(([^[]+)\[([^\]]+)\]\)$/i);
  const divideMatch = expression.match(/^DIVIDE\(\s*SUM\(([^[]+)\[([^\]]+)\]\)\s*,\s*COUNTROWS\(([^)]+)\)\s*\)$/i);
  const calculateMatch = expression.match(/^CALCULATE\(SUM\(([^[]+)\[([^\]]+)\]\),\s*([^[]+)\[([^\]]+)\]\s*=\s*"([^"]+)"\s*\)$/i);

  if (sumMatch) {
    const total = sumColumn(rows, sumMatch[2]);
    return { value: String(total), explanation: `SUM over column ${sumMatch[2]} on ${rows.length} row(s).` };
  }
  if (avgMatch) {
    const values = numberColumn(rows, avgMatch[2]);
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return { value: String(avg), explanation: `AVERAGE over column ${avgMatch[2]} using ${values.length} numeric row(s).` };
  }
  if (countRowsMatch) {
    return { value: String(rows.length), explanation: `COUNTROWS on current_data returned ${rows.length}.` };
  }
  if (countMatch) {
    const count = rows.filter((row) => row[countMatch[2]] !== "" && row[countMatch[2]] !== null && row[countMatch[2]] !== undefined).length;
    return { value: String(count), explanation: `COUNT over column ${countMatch[2]} returned ${count}.` };
  }
  if (distinctMatch) {
    const distinct = new Set(rows.map((row) => String(row[distinctMatch[2]] ?? ""))).size;
    return { value: String(distinct), explanation: `DISTINCTCOUNT over column ${distinctMatch[2]}.` };
  }
  if (minMatch) {
    const values = numberColumn(rows, minMatch[2]);
    return { value: String(Math.min(...values)), explanation: `MIN over column ${minMatch[2]}.` };
  }
  if (maxMatch) {
    const values = numberColumn(rows, maxMatch[2]);
    return { value: String(Math.max(...values)), explanation: `MAX over column ${maxMatch[2]}.` };
  }
  if (divideMatch) {
    const denominator = rows.length;
    const numerator = sumColumn(rows, divideMatch[2]);
    const value = denominator ? numerator / denominator : 0;
    return { value: String(value), explanation: `DIVIDE of SUM(${divideMatch[2]}) by COUNTROWS(current_data).` };
  }
  if (calculateMatch) {
    const filtered = rows.filter((row) => String(row[calculateMatch[4]] ?? "") === calculateMatch[5]);
    const total = sumColumn(filtered, calculateMatch[2]);
    return {
      value: String(total),
      explanation: `CALCULATE with a simple equality filter on ${calculateMatch[4]} = ${calculateMatch[5]}. ${filtered.length} row(s) matched.`,
    };
  }

  return {
    value: "Unsupported",
    explanation: "Practice mode supports SUM, AVERAGE, COUNT, COUNTROWS, DISTINCTCOUNT, MIN, MAX, DIVIDE, and simple CALCULATE(SUM(...), Column = \"value\") patterns.",
  };
}

function numberColumn(rows: Record<string, unknown>[], column: string) {
  return rows.map((row) => Number(row[column])).filter((value) => Number.isFinite(value));
}

function sumColumn(rows: Record<string, unknown>[], column: string) {
  return numberColumn(rows, column).reduce((a, b) => a + b, 0);
}
