import { startServer } from "./modules/server";

const WORKSPACE_CWD_ENV = "PI_MONO_WORKSPACE_CWD";
const workspaceRootOverride = process.env[WORKSPACE_CWD_ENV]?.trim();

startServer(workspaceRootOverride ? { workspaceRoot: workspaceRootOverride } : undefined);
