export type ProviderId = "huggingface" | "openai" | "openrouter" | "ollama";
export type ProviderChoice = ProviderId | "auto";

export type ProviderConfig = {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
  supportsLocalTools: boolean;
  status: "configured" | "missing";
};

export type AgentTask = {
  id: string;
  title: string;
  instruction: string;
  status: "queued" | "running" | "done";
  provider: ProviderId;
  createdAt: string;
  updatedAt: string;
  lastResult?: string;
};

export type MemoryItem = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
};

export type ModuleDefinition = {
  id: string;
  name: string;
  category: "provider" | "tool" | "automation" | "memory";
  description: string;
  status: "ready" | "coming-soon";
};

export type AppState = {
  providers: ProviderConfig[];
  tasks: AgentTask[];
  memory: MemoryItem[];
  modules: ModuleDefinition[];
  storageMode: "local" | "google-drive";
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
};
