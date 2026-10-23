import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareWebWorkspace, webEnvironment } from "../../src/web/environment.js";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
await prepareWebWorkspace(workspace);
const environment = webEnvironment(workspace);
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);
process.chdir(workspace);

// Keep stdio attached to Pi. Load the pinned upstream MCP server without another process or Agent Loop.
const { startServer } = await import(pathToFileURL(resolve(workspace, "node_modules/wigolo/dist/server.js")).href);
await startServer();
