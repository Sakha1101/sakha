import { createChatCompletion } from "@/lib/openai-compatible";
import { getProviderById, getProviderKey, getProviders, pickProvider } from "@/lib/providers";
import { appendMemory, getAppState, upsertTask } from "@/lib/storage";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { executeTool, toolSpecs } from "@/lib/tools";
import { AgentTask, ChatMessage, ProviderChoice, ProviderId } from "@/lib/types";

export async function runAgent({
  providerId,
  message,
  runtimeProvider,
}: {
  providerId: ProviderChoice;
  message: string;
  runtimeProvider?: {
    id: ProviderId;
    apiKey?: string;
    model?: string;
  };
}) {
  const state = await getAppState();
  const resolvedProvider = runtimeProvider?.id
    ? {
        ...getProviderById(runtimeProvider.id),
        defaultModel: runtimeProvider.model || getProviderById(runtimeProvider.id).defaultModel,
        status: runtimeProvider.apiKey ? "configured" : getProviderById(runtimeProvider.id).status,
      }
    : providerId === "auto"
      ? pickProvider(message, state.providers)
      : getProviders().find((provider) => provider.id === providerId) ?? state.providers[0];
  const apiKey = runtimeProvider?.apiKey || getProviderKey(resolvedProvider);

  if (resolvedProvider.status === "missing") {
    const fallback = buildOfflineReply(message);
    const task: AgentTask = {
      id: crypto.randomUUID(),
      title: message.slice(0, 48),
      instruction: message,
      status: "done",
      provider: "huggingface",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastResult: fallback,
    };

    await upsertTask(task);

    return {
      message: fallback,
      task,
      resolvedProvider: "Offline mode",
      state: await getAppState(),
    };
  }

  const systemPrompt = buildSystemPrompt(resolvedProvider, state.memory);
  const conversation: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  const firstPass = await createChatCompletion({
    provider: resolvedProvider,
    apiKey,
    model: resolvedProvider.defaultModel,
    messages: conversation,
    tools: resolvedProvider.supportsLocalTools ? toolSpecs : undefined,
  });

  let finalText = firstPass.content;

  if (firstPass.toolCalls.length) {
    conversation.push({
      role: "assistant",
      content: firstPass.content || "Calling tools",
      toolCalls: firstPass.toolCalls,
    });

    for (const toolCall of firstPass.toolCalls) {
      const args = safeParse(toolCall.function.arguments);
      const output = await executeTool(toolCall.function.name, args);

      conversation.push({
        role: "tool",
        toolCallId: toolCall.id,
        name: toolCall.function.name,
        content: output,
      });
    }

    const secondPass = await createChatCompletion({
      provider: resolvedProvider,
      apiKey,
      model: resolvedProvider.defaultModel,
      messages: conversation,
    });

    finalText = secondPass.content;
  }

  const task: AgentTask = {
    id: crypto.randomUUID(),
    title: message.slice(0, 48),
    instruction: message,
    status: "done",
    provider: resolvedProvider.id,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastResult: finalText,
  };

  await upsertTask(task);
  await appendMemory({
    id: crypto.randomUUID(),
    title: `Task insight: ${task.title}`,
    content: finalText.slice(0, 400),
    createdAt: new Date().toISOString(),
  });

  const nextState = await getAppState();

  return {
    message: finalText,
    task,
    resolvedProvider: resolvedProvider.label,
    state: nextState,
  };
}

function safeParse(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildOfflineReply(message: string) {
  return [
    "Sakha is running in offline mode right now, so live model execution is unavailable.",
    "",
    `Your request: ${message}`,
    "",
    "Best next step:",
    "- If this is a coding task, open the Code tab and run code locally on your laptop.",
    "- If this is a planning or writing task, add one provider key in deployment settings and Sakha will handle it from the chat workspace.",
    "- If you want local machine actions, run Sakha on your laptop instead of the hosted site.",
  ].join("\n");
}
