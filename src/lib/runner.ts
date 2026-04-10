import { createChatCompletion } from "@/lib/openai-compatible";
import { getProviderKey, getProviders, pickProvider } from "@/lib/providers";
import { appendMemory, getAppState, upsertTask } from "@/lib/storage";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { executeTool, toolSpecs } from "@/lib/tools";
import { AgentTask, ChatMessage, ProviderChoice } from "@/lib/types";

export async function runAgent({
  providerId,
  message,
}: {
  providerId: ProviderChoice;
  message: string;
}) {
  const state = await getAppState();
  const resolvedProvider =
    providerId === "auto"
      ? pickProvider(message, state.providers)
      : getProviders().find((provider) => provider.id === providerId) ?? state.providers[0];
  const apiKey = getProviderKey(resolvedProvider);

  if (resolvedProvider.status === "missing" && resolvedProvider.id !== "ollama") {
    throw new Error(
      `Missing ${resolvedProvider.apiKeyEnv}. Add it to your environment before using ${resolvedProvider.label}.`,
    );
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
