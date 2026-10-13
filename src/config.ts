import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(process.cwd(), ".env"));
} catch {
  // el .env es opcional
}

export interface Perfil {
  nombre: string;
  sector: string;
  tamano: string;
  palabrasClave: string[];
  palabrasExcluir: string[];
  departamentos: string[];
  presupuestoMinCOP: number;
  presupuestoMaxCOP: number;
  experienciaAnios: number;
  contratosPreviosCOP: number;
  capacidadFinancieraCOP: number;
  modalidadesPreferidas: string[];
}

export const config = {
  apiKey: process.env.RETO_API_KEY ?? "",
  baseUrl: process.env.RETO_BASE_URL ?? "https://api.reto.pltk.mx/v1",
  model: process.env.RETO_MODEL ?? "grok-4.7",
  appToken: process.env.DATOS_ABIERTOS_APP_TOKEN ?? "",
  perfilPath: process.env.PERFIL_PATH ?? "config/perfil.example.json",
  maxPasos: Number.parseInt(process.env.MAX_PASOS ?? "25", 10),
  outDir: "out",
};

export function cargarPerfil(ruta: string = config.perfilPath): Perfil {
  const bruto = readFileSync(resolve(process.cwd(), ruta), "utf-8");
  return JSON.parse(bruto) as Perfil;
}