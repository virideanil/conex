// Opens conex to your phone: builds the page, starts the server, raises an
// HTTPS tunnel (the phone's location api needs https) and prints the address
// as a QR code. Scan it, then add it to the home screen.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import { bin } from "cloudflared";
import qr from "qrcode-terminal";

const root = path.join(import.meta.dirname, "..");
const PORT = Number(process.env.PORT) || 3000;
const run = (cmd: string, args: string[]) => new Promise<void>((res, rej) => { const c = spawn(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" }); c.on("exit", (code) => (code ? rej(new Error(`${cmd} exited ${code}`)) : res())); });

if (!existsSync(path.join(root, "dist", "index.html"))) await run("npm", ["run", "build"]);

const server = spawn(process.execPath, ["server/index.ts"], { cwd: root, stdio: "inherit", env: { ...process.env, PORT: String(PORT) } });
const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;

const tunnel = spawn(bin, ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"], { cwd: root });
let shown = false;
tunnel.stderr.on("data", (d: Buffer) => {
  const m = String(d).match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/); // the generated name, not api.trycloudflare.com
  if (m && !shown) {
    shown = true;
    console.log(`\nconex · ${m[0]}\n`);
    qr.generate(m[0], { small: true });
    console.log(`\nscan · open · share → add to home screen\n(on this network: http://${lan ?? "localhost"}:${PORT}, no location over http)\n`);
  }
});
tunnel.on("exit", (code) => { if (!shown) console.log(`no tunnel (cloudflared exited ${code}) · on this network: http://${lan ?? "localhost"}:${PORT}`); });

const stop = () => { tunnel.kill(); server.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
