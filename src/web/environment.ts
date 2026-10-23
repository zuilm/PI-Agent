import { mkdir } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";

export function webPaths(workspace: string) {
  const root = resolve(workspace, ".pi/web");
  const data = join(root, "data");
  return { root, data, config: join(root, "config.json"), browsers: join(data, "browsers"), models: join(data, "models"), temporary: join(data, "tmp") };
}

export function webEnvironment(workspace: string, inherited: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const paths = webPaths(workspace);
  // The search server needs no model, E2B or internal bridge credentials.
  const safe = Object.fromEntries(Object.entries(inherited).filter(([key]) => !/(?:API_KEY|TOKEN|SECRET|PASSWORD|SPAWN_PI_BRIDGE_URL|WIGOLO_|PLAYWRIGHT_|HF_HOME|TRANSFORMERS_CACHE|FASTEMBED_CACHE)/i.test(key)));
  return { ...safe,
    WIGOLO_CONFIG_PATH: paths.config, WIGOLO_DATA_DIR: paths.data,
    WIGOLO_PLUGINS_DIR: join(paths.root, "plugins"), WIGOLO_SHELL_HISTORY_PATH: join(paths.data, "shell-history"),
    PLAYWRIGHT_BROWSERS_PATH: paths.browsers, HF_HOME: paths.models,
    PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT: "30000",
    TRANSFORMERS_CACHE: paths.models, FASTEMBED_CACHE_PATH: join(paths.models, "fastembed"),
    TEMP: paths.temporary, TMP: paths.temporary, TMPDIR: paths.temporary,
    WIGOLO_EAGER_WARMUP: "0", WIGOLO_WARM_ENGINES: "0",
    WIGOLO_FETCH_ALLOW_PRIVATE: "false",
    PATH: `${dirname(process.execPath)}${delimiter}${inherited.PATH ?? inherited.Path ?? ""}`,
  };
}

export async function prepareWebWorkspace(workspace: string) {
  const paths = webPaths(workspace);
  await Promise.all([paths.data, paths.browsers, paths.models, paths.temporary, join(paths.root, "plugins")].map((path) => mkdir(path, { recursive: true })));
  return paths;
}
