import { fileURLToPath } from "node:url";

export const runtimeRoot = fileURLToPath(new URL("../../", import.meta.url));
