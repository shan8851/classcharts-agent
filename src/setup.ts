// `classcharts setup`: a person enters the parent login once; it's tested, then saved privately.
// Deliberately interactive-only, so an agent can't pipe a password through it.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { ClassChartsClient } from "./client.ts";
import { fileSessionStore } from "./session.ts";

export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "classcharts-agent");
}

export const configEnvFile = () => join(configDir(), ".env");

/** Quote a value for a .env file using a quote character the value doesn't contain. */
export function envQuote(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("Values can't contain line breaks.");
  for (const q of ["'", '"', "`"]) if (!value.includes(q)) return `${q}${value}${q}`;
  throw new Error("That value contains every quote character, so it can't be saved safely. Use environment variables instead.");
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const done = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done(), resolve(value);
        if (ch === "\u0003") return done(), reject(new Error("Cancelled."));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export async function setup(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("`classcharts setup` asks for a password, so a person needs to run it in a terminal.");
  }
  const file = configEnvFile();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("Sign in with your ClassCharts parent account (the one you use on classcharts.com).");
  if (existsSync(file)) console.log(`This replaces the login saved in ${file}.`);
  const email = (await rl.question("Email: ")).trim();
  rl.close();
  if (!email) throw new Error("No email entered.");
  const password = await askHidden("Password (hidden): ");
  if (!password) throw new Error("No password entered.");

  // Test before saving. The session is cached, so the first real command won't log in again.
  const client = new ClassChartsClient({ email, password, session: fileSessionStore(email) });
  const pupils = await client.pupils();

  let pupilLine = "";
  if (pupils.length > 1) {
    const list = pupils.map((p, i) => `  ${i + 1}. ${p.name} (${p.school_name})`).join("\n");
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    const pick = (await rl2.question(`Children on this account:\n${list}\nDefault child (number, or Enter for none): `)).trim();
    rl2.close();
    const chosen = pupils[Number(pick) - 1];
    if (chosen) pupilLine = `CLASSCHARTS_PUPIL=${envQuote(String(chosen.id))}\n`;
  }

  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    `# Saved by \`classcharts setup\`. Readable only by you.\nCLASSCHARTS_EMAIL=${envQuote(email)}\nCLASSCHARTS_PASSWORD=${envQuote(password)}\n${pupilLine}`,
    { mode: 0o600 },
  );
  const names = pupils.map((p) => `${p.name} (${p.school_name})`).join(", ");
  return `Signed in. Found: ${names || "no linked children"}.\nSaved to ${file}.\nTry: classcharts digest`;
}
