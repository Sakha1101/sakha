import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const allowedCommands = new Set(["cmd", "where", "ipconfig"]);

export const toolSpecs = [
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List files in a local directory.",
      parameters: {
        type: "object",
        properties: {
          targetPath: { type: "string" },
        },
        required: ["targetPath"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a local text file.",
      parameters: {
        type: "object",
        properties: {
          targetPath: { type: "string" },
        },
        required: ["targetPath"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write a local UTF-8 file.",
      parameters: {
        type: "object",
        properties: {
          targetPath: { type: "string" },
          content: { type: "string" },
        },
        required: ["targetPath", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_text",
      description: "Search text recursively in local files.",
      parameters: {
        type: "object",
        properties: {
          targetPath: { type: "string" },
          query: { type: "string" },
        },
        required: ["targetPath", "query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_safe_command",
      description: "Run a small allowlisted Windows command for diagnostics.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          args: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["command"],
      },
    },
  },
];

type ToolInput = Record<string, unknown>;

function resolveTarget(targetPath: string) {
  return path.resolve(targetPath);
}

export async function executeTool(name: string, input: ToolInput) {
  switch (name) {
    case "list_directory": {
      const target = resolveTarget(String(input.targetPath));
      const items = await fs.readdir(target, { withFileTypes: true });
      return items.map((item) => `${item.isDirectory() ? "[dir]" : "[file]"} ${item.name}`).join("\n");
    }
    case "read_file": {
      const target = resolveTarget(String(input.targetPath));
      return await fs.readFile(target, "utf8");
    }
    case "write_file": {
      const target = resolveTarget(String(input.targetPath));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(input.content), "utf8");
      return `Saved ${target}`;
    }
    case "search_text": {
      const target = resolveTarget(String(input.targetPath));
      const query = String(input.query).toLowerCase();
      const results: string[] = [];

      async function walk(currentPath: string): Promise<void> {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
            continue;
          }
          try {
            const content = await fs.readFile(fullPath, "utf8");
            if (content.toLowerCase().includes(query)) {
              results.push(fullPath);
            }
          } catch {
            continue;
          }
        }
      }

      await walk(target);
      return results.join("\n") || "No matches found.";
    }
    case "run_safe_command": {
      const command = String(input.command);
      const args = Array.isArray(input.args) ? input.args.map(String) : [];

      if (!allowedCommands.has(command)) {
        return `Blocked command: ${command}`;
      }

      const { stdout, stderr } = await execFileAsync(command, args, {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });

      return [stdout, stderr].filter(Boolean).join("\n").trim() || "Command finished with no output.";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
