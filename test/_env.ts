// Imported first by every test: results go to a throwaway folder, never data/.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.CONEX_DATA_DIR = mkdtempSync(path.join(tmpdir(), "conex-test-"));
