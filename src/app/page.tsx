import { ChatShell } from "@/components/chat-shell";
import { getAppState } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const state = await getAppState();

  return <ChatShell initialState={state} />;
}
