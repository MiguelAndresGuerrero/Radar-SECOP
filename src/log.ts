import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";

mkdirSync(config.outDir, { recursive: true });

const rutaBitacora = join(config.outDir, "bitacora.jsonl");

export function bitacora(evento: Record<string, unknown>): void {
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...evento });
  appendFileSync(rutaBitacora, linea + "\n", "utf-8");
}

export function info(mensaje: string): void {
  console.log(`[${new Date().toISOString()}] ${mensaje}`);
}