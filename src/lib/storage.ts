import { promises as fs } from "fs";
import os from "os";
import path from "path";

import { MODULES } from "@/lib/modules";
import { getProviders } from "@/lib/providers";
import { AppState, MemoryItem, AgentTask } from "@/lib/types";

const dataDir = process.env.VERCEL
  ? path.join(os.tmpdir(), "sakha")
  : path.join(process.cwd(), "data");
const stateFile = path.join(dataDir, "sakha-state.json");
const driveFileName = process.env.GOOGLE_DRIVE_FILE_NAME || "sakha-state.json";
const storageMode = process.env.STORAGE_BACKEND === "google-drive" ? "google-drive" : "local";

const baseState = (): Pick<AppState, "tasks" | "memory"> => ({
  tasks: [
    {
      id: "sample-task",
      title: "Build a research shortlist",
      instruction: "Compare two open-source vision models and summarise which one fits mobile use best.",
      status: "queued",
      provider: "huggingface",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
  memory: [
    {
      id: "sakha-style",
      title: "Working style",
      content:
        "Prefer practical answers, use free/open resources first, and only switch to paid models for high-value reasoning tasks.",
      createdAt: new Date().toISOString(),
    },
  ],
});

async function ensureStateFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(stateFile);
  } catch {
    await fs.writeFile(stateFile, JSON.stringify(baseState(), null, 2), "utf8");
  }
}

async function readLocalState(): Promise<{ tasks: AgentTask[]; memory: MemoryItem[] }> {
  await ensureStateFile();
  const raw = await fs.readFile(stateFile, "utf8");
  return JSON.parse(raw) as { tasks: AgentTask[]; memory: MemoryItem[] };
}

async function writeLocalState(state: { tasks: AgentTask[]; memory: MemoryItem[] }) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}

async function readDriveState(): Promise<{ tasks: AgentTask[]; memory: MemoryItem[] }> {
  const accessToken = await getGoogleAccessToken();
  const fileId = await findDriveStateFile(accessToken);

  if (!fileId) {
    const initial = baseState();
    await createDriveStateFile(accessToken, initial);
    return initial;
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Google Drive read failed: ${response.status}`);
  }

  return (await response.json()) as { tasks: AgentTask[]; memory: MemoryItem[] };
}

async function writeDriveState(state: { tasks: AgentTask[]; memory: MemoryItem[] }) {
  const accessToken = await getGoogleAccessToken();
  const fileId = await findDriveStateFile(accessToken);

  if (!fileId) {
    await createDriveStateFile(accessToken, state);
    return;
  }

  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive write failed: ${response.status} ${text}`);
  }
}

async function readBaseState(): Promise<{ tasks: AgentTask[]; memory: MemoryItem[] }> {
  return storageMode === "google-drive" ? readDriveState() : readLocalState();
}

async function writeBaseState(state: { tasks: AgentTask[]; memory: MemoryItem[] }) {
  return storageMode === "google-drive" ? writeDriveState(state) : writeLocalState(state);
}

async function getGoogleAccessToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Google Drive storage is enabled but GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REFRESH_TOKEN is missing.",
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function findDriveStateFile(accessToken: string) {
  const query = encodeURIComponent(`name='${driveFileName}' and trashed=false`);
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive file lookup failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id;
}

async function createDriveStateFile(
  accessToken: string,
  state: { tasks: AgentTask[]; memory: MemoryItem[] },
) {
  const boundary = `sakha-${Date.now()}`;
  const metadata = {
    name: driveFileName,
    parents: ["appDataFolder"],
    mimeType: "application/json",
  };

  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(state),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive create failed: ${response.status} ${text}`);
  }
}

export async function getAppState(): Promise<AppState> {
  const current = await readBaseState();
  return {
    ...current,
    providers: getProviders(),
    modules: MODULES,
    storageMode,
  };
}

export async function appendMemory(item: MemoryItem) {
  const state = await readBaseState();
  state.memory = [item, ...state.memory].slice(0, 50);
  await writeBaseState(state);
}

export async function upsertTask(task: AgentTask) {
  const state = await readBaseState();
  const existingIndex = state.tasks.findIndex((entry) => entry.id === task.id);
  if (existingIndex >= 0) {
    state.tasks[existingIndex] = task;
  } else {
    state.tasks.unshift(task);
  }
  state.tasks = state.tasks.slice(0, 50);
  await writeBaseState(state);
}
