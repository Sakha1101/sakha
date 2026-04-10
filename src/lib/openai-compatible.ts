import { ChatMessage, ProviderConfig, ToolCall } from "@/lib/types";

type ToolSpec = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type CompletionRequest = {
  provider: ProviderConfig;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
};

type CompletionResponse = {
  content: string;
  toolCalls: ToolCall[];
};

export async function createChatCompletion({
  provider,
  apiKey,
  model,
  messages,
  tools,
}: CompletionRequest): Promise<CompletionResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "Operator One";
  }

  const payloadMessages = messages.map((message) => ({
    role: message.role,
    content: message.content,
    name: message.name,
    tool_call_id: message.toolCallId,
    tool_calls: message.toolCalls,
  }));

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: payloadMessages,
      tools,
      tool_choice: tools?.length ? "auto" : undefined,
      temperature: 0.4,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0]?.message;

  return {
    content: choice?.content ?? "",
    toolCalls: choice?.tool_calls ?? [],
  };
}
