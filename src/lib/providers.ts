import { ProviderConfig, ProviderId } from "@/lib/types";

const providerTemplates: Record<ProviderId, Omit<ProviderConfig, "status">> = {
  huggingface: {
    id: "huggingface",
    label: "Hugging Face Router",
    baseUrl: "https://router.huggingface.co/v1",
    apiKeyEnv: "HUGGINGFACE_API_KEY",
    defaultModel: process.env.HUGGINGFACE_MODEL || "your-hf-model",
    supportsLocalTools: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI API",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultModel: process.env.OPENAI_MODEL || "your-openai-model",
    supportsLocalTools: true,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: process.env.OPENROUTER_MODEL || "your-openrouter-model",
    supportsLocalTools: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama Local",
    baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1",
    apiKeyEnv: "OLLAMA_API_KEY",
    defaultModel: process.env.OLLAMA_MODEL || "llama3.2",
    supportsLocalTools: true,
  },
};

export function getProviders(): ProviderConfig[] {
  return Object.values(providerTemplates).map((provider) => ({
    ...provider,
    status: provider.id === "ollama" || process.env[provider.apiKeyEnv] ? "configured" : "missing",
  }));
}

export function getProviderById(id: ProviderId): ProviderConfig {
  return getProviders().find((provider) => provider.id === id) ?? getProviders()[0];
}

export function getProviderKey(provider: ProviderConfig): string | undefined {
  return process.env[provider.apiKeyEnv];
}

export function pickProvider(message: string, providers: ProviderConfig[]): ProviderConfig {
  const configured = providers.filter((provider) => provider.status === "configured");
  const available = configured.length ? configured : providers.filter((provider) => provider.id === "ollama");
  const text = message.toLowerCase();

  const wantsLocal = /(file|folder|desktop|laptop|command|terminal|codebase|local machine|install|setup)/.test(text);
  const wantsCoding = /(code|debug|fix|refactor|build app|typescript|react|next\.js|script)/.test(text);
  const wantsResearch = /(research|compare|summari[sz]e|study|find best|evaluate|analy[sz]e)/.test(text);

  if ((wantsLocal || wantsCoding) && available.find((provider) => provider.id === "openai")) {
    return available.find((provider) => provider.id === "openai")!;
  }

  if (wantsResearch && available.find((provider) => provider.id === "openrouter")) {
    return available.find((provider) => provider.id === "openrouter")!;
  }

  if (available.find((provider) => provider.id === "huggingface")) {
    return available.find((provider) => provider.id === "huggingface")!;
  }

  if (available.find((provider) => provider.id === "openrouter")) {
    return available.find((provider) => provider.id === "openrouter")!;
  }

  if (available.find((provider) => provider.id === "openai")) {
    return available.find((provider) => provider.id === "openai")!;
  }

  return available[0] ?? providers[0];
}
