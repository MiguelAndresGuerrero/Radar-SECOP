import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { config, type Perfil } from "./config.js";
import { bitacora, info } from "./log.js";
import { crearHerramientas, type Herramienta } from "./tools/index.js";

const MAX_RESULTADO_HERRAMIENTA = 12_000;

function promptDeSistema(perfil: Perfil): string {
  return `Eres Radar SECOP, un agente que trabaja para una pyme colombiana. Revisas los procesos abiertos de SECOP II, encuentras los pocos que le convienen a la empresa y le avisas solo de esos.

Perfil de la empresa:
${JSON.stringify(perfil, null, 2)}

Cómo trabajas:
1. Busca procesos recientes con buscar_procesos_secop, una vez por cada palabra clave del perfil.
2. Evalúa los candidatos con filtrar_por_perfil, pasando los ids en lote.
3. Lee con leer_detalle_proceso los mejor puntuados (máximo 5) y analiza qué pide la entidad, si la empresa cumple experiencia y capacidad financiera, y qué cláusulas son riesgosas: plazos imposibles, pólizas desproporcionadas, penalidades abiertas, experiencia exigida mayor a la de la empresa.
4. Por cada proceso que sí valga la pena, llama guardar_alerta. No guardes alertas de procesos que no convienen.
5. Al terminar, responde con un resumen breve en español: cuántos procesos revisaste, cuántas alertas guardaste y por qué descartaste el resto.

Reglas:
- No inventes datos. Si no pudiste leer el pliego, dilo y basa el análisis solo en lo que tienes. No afirmes cláusulas que no viste.
- Si una herramienta devuelve error, intenta una vez con otros parámetros. Si persiste, sigue con lo que tengas y repórtalo.
- No repitas la misma búsqueda. Usa pocas llamadas y bien elegidas.`;
}

function aEsquema(herramientas: Herramienta[]): ChatCompletionTool[] {
  return herramientas.map((h) => ({
    type: "function",
    function: { name: h.nombre, description: h.descripcion, parameters: h.parametros },
  }));
}

export interface ResultadoEjecucion {
  pasos: number;
  tokensEntrada: number;
  tokensSalida: number;
  respuestaFinal: string;
  terminoPorLimite: boolean;
}

export async function ejecutarAgente(perfil: Perfil): Promise<ResultadoEjecucion> {
  if (!config.apiKey) {
    throw new Error("Falta RETO_API_KEY. Ponla en tu archivo .env (ver .env.example).");
  }

  const cliente = new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    maxRetries: 4,
    timeout: 120_000,
  });

  const herramientas = crearHerramientas(perfil);
  const porNombre = new Map(herramientas.map((h) => [h.nombre, h]));
  const esquema = aEsquema(herramientas);

  const hoy = new Date().toISOString().slice(0, 10);
  const mensajes: ChatCompletionMessageParam[] = [
    { role: "system", content: promptDeSistema(perfil) },
    {
      role: "user",
      content: `Hoy es ${hoy}. Revisa los procesos publicados en los últimos 7 días y avísame de las oportunidades que valgan la pena.`,
    },
  ];

  let tokensEntrada = 0;
  let tokensSalida = 0;
  let pasos = 0;

  bitacora({ evento: "inicio", modelo: config.model, perfil: perfil.nombre, maxPasos: config.maxPasos });

  while (pasos < config.maxPasos) {
    pasos++;
    const t0 = Date.now();
    const respuesta = await cliente.chat.completions.create({
      model: config.model,
      messages: mensajes,
      tools: esquema,
      tool_choice: "auto",
    });

    const uso = respuesta.usage;
    tokensEntrada += uso?.prompt_tokens ?? 0;
    tokensSalida += uso?.completion_tokens ?? 0;

    const mensaje = respuesta.choices[0]?.message;
    if (!mensaje) throw new Error("El modelo no devolvió ningún mensaje.");
    mensajes.push(mensaje);

    const llamadas = mensaje.tool_calls ?? [];
    bitacora({
      evento: "llamada_modelo",
      paso: pasos,
      ms: Date.now() - t0,
      tokensEntrada: uso?.prompt_tokens ?? 0,
      tokensSalida: uso?.completion_tokens ?? 0,
      llamadasHerramienta: llamadas.length,
    });

    if (llamadas.length === 0) {
      info(`El agente terminó en ${pasos} pasos`);
      return {
        pasos,
        tokensEntrada,
        tokensSalida,
        respuestaFinal: mensaje.content ?? "",
        terminoPorLimite: false,
      };
    }

    for (const llamada of llamadas) {
      if (llamada.type !== "function") continue;
      const nombre = llamada.function.name;
      const t1 = Date.now();
      let resultado: unknown;
      let args: Record<string, unknown> = {};

      try {
        const herramienta = porNombre.get(nombre);
        if (!herramienta) throw new Error(`Herramienta desconocida: ${nombre}`);
        args = JSON.parse(llamada.function.arguments || "{}");
        resultado = await herramienta.ejecutar(args);
      } catch (err) {
        resultado = { error: err instanceof Error ? err.message : String(err) };
      }

      const serializado = JSON.stringify(resultado).slice(0, MAX_RESULTADO_HERRAMIENTA);
      const huboError = typeof resultado === "object" && resultado !== null && "error" in resultado;
      bitacora({
        evento: "herramienta",
        paso: pasos,
        herramienta: nombre,
        args,
        ms: Date.now() - t1,
        error: huboError,
        bytesResultado: serializado.length,
      });
      info(`  ${nombre} (${Date.now() - t1} ms)`);

      mensajes.push({ role: "tool", tool_call_id: llamada.id, content: serializado });
    }
  }

  bitacora({ evento: "limite_de_pasos", pasos });
  info(`Se alcanzó el máximo de ${config.maxPasos} pasos`);
  return { pasos, tokensEntrada, tokensSalida, respuestaFinal: "", terminoPorLimite: true };
}