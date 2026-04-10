import { ModuleDefinition } from "@/lib/types";

export const MODULES: ModuleDefinition[] = [
  {
    id: "provider-hf-router",
    name: "Hugging Face Router",
    category: "provider",
    description: "Use open and free-friendly inference providers behind a single OpenAI-compatible endpoint.",
    status: "ready",
  },
  {
    id: "provider-openai",
    name: "OpenAI API",
    category: "provider",
    description: "Connect a paid OpenAI API key when you want stronger reasoning or structured tool calls.",
    status: "ready",
  },
  {
    id: "provider-ollama",
    name: "Ollama Local Models",
    category: "provider",
    description: "Run local models on your laptop for private tasks and offline experiments.",
    status: "ready",
  },
  {
    id: "tool-local-ops",
    name: "Local Operations",
    category: "tool",
    description: "Guarded file and shell actions for laptop-hosted sessions, with safe defaults and a narrow command allowlist.",
    status: "ready",
  },
  {
    id: "memory-profile",
    name: "Adaptive Memory",
    category: "memory",
    description: "Stores your preferences, reusable instructions, and recent task outcomes so the agent becomes more helpful over time.",
    status: "ready",
  },
  {
    id: "module-market-watch",
    name: "Module Market Watch",
    category: "automation",
    description: "Placeholder for automatic discovery of new open or free modules you may want to install next.",
    status: "coming-soon",
  },
];
