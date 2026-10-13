import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ejecutarAgente } from "./agent.js";
import { cargarPerfil, config } from "./config.js";
import { bitacora, info } from "./log.js";
import { buscarProcesos } from "./secop.js";

async function soloSecop(): Promise<void> {
  const perfil = cargarPerfil();
  const palabra = perfil.palabrasClave[0] ?? "software";
  info(`Consultando SECOP II con "${palabra}"`);
  const procesos = await buscarProcesos({ palabraClave: palabra, diasAtras: 14, limite: 5 });
  const vista = procesos.map((p) => ({
    id: p.idDelProceso,
    entidad: p.entidad,
    objeto: p.nombre.slice(0, 100),
    precio: p.precioBaseCOP,
    publicado: p.fechaPublicacion.slice(0, 10),
  }));
  console.log(JSON.stringify(vista, null, 2));
  info(`${procesos.length} procesos recibidos`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--solo-secop")) {
    await soloSecop();
    return;
  }

  const perfil = cargarPerfil();
  info(`Radar SECOP, modelo ${config.model}, empresa ${perfil.nombre}`);

  try {
    const r = await ejecutarAgente(perfil);
    const resumen = [
      "# Resumen de la ejecución",
      "",
      `- Pasos: ${r.pasos}${r.terminoPorLimite ? " (se detuvo por el tope de pasos)" : ""}`,
      `- Tokens de entrada: ${r.tokensEntrada}`,
      `- Tokens de salida: ${r.tokensSalida}`,
      "",
      r.respuestaFinal || "El agente no entregó un resumen final.",
      "",
    ].join("\n");
    writeFileSync(join(config.outDir, "resumen.md"), resumen, "utf-8");
    bitacora({ evento: "fin", pasos: r.pasos, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida });
    console.log("\n" + r.respuestaFinal);
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    bitacora({ evento: "error_fatal", mensaje });
    console.error(`Error: ${mensaje}`);
    process.exitCode = 1;
  }
}

void main();