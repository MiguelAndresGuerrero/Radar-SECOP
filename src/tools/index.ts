import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Perfil } from "../config.js";
import { config } from "../config.js";
import { buscarProcesos, fetchConReintentos, type Proceso } from "../secop.js";

export interface Herramienta {
  nombre: string;
  descripcion: string;
  parametros: Record<string, unknown>;
  ejecutar: (args: Record<string, unknown>) => Promise<unknown>;
}

const MAX_TEXTO_PLIEGO = 10_000;

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function claveDepartamento(s: string): string {
  return normalizar(s)
    .replace(/distrito capital de|departamento del?|\bd\.?\s?c\b\.?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cop(n: number | null): string {
  return n == null ? "desconocido" : `$${Math.round(n).toLocaleString("es-CO")} COP`;
}

function aNumero(v: unknown, porDefecto: number): number {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : porDefecto;
}

function aLista(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function textoPlano(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function crearHerramientas(perfil: Perfil): Herramienta[] {
  const cache = new Map<string, Proceso>();

  const buscar: Herramienta = {
    nombre: "buscar_procesos_secop",
    descripcion:
      "Busca en SECOP II procesos abiertos publicados recientemente que mencionen una palabra clave. " +
      "Devuelve id, entidad, objeto, presupuesto, modalidad, departamento y fecha. " +
      "Úsala una vez por cada palabra clave del perfil.",
    parametros: {
      type: "object",
      properties: {
        palabra_clave: { type: "string", description: "Término a buscar, por ejemplo 'software'." },
        dias_atras: { type: "integer", description: "Ventana de publicación en días. Por defecto 7." },
        departamento: { type: "string", description: "Nombre exacto del departamento de la entidad. Opcional." },
        limite: { type: "integer", description: "Máximo de resultados, de 1 a 50. Por defecto 20." },
      },
      required: ["palabra_clave"],
    },
    async ejecutar(args) {
      const procesos = await buscarProcesos({
        palabraClave: String(args["palabra_clave"] ?? ""),
        diasAtras: aNumero(args["dias_atras"], 7),
        departamento: args["departamento"] ? String(args["departamento"]) : undefined,
        limite: Math.min(aNumero(args["limite"], 20), 50),
      });
      for (const p of procesos) cache.set(p.idDelProceso, p);
      return {
        total: procesos.length,
        procesos: procesos.map((p) => ({
          id_del_proceso: p.idDelProceso,
          entidad: p.entidad,
          objeto: p.nombre,
          presupuesto: cop(p.precioBaseCOP),
          modalidad: p.modalidad,
          departamento: p.departamento,
          publicado: p.fechaPublicacion.slice(0, 10),
        })),
      };
    },
  };

  const filtrar: Herramienta = {
    nombre: "filtrar_por_perfil",
    descripcion:
      "Calcula un puntaje de 0 a 100 de qué tan bien encaja cada proceso con el perfil de la empresa " +
      "(presupuesto, departamento, palabras clave, exclusiones y modalidad) y explica por qué. " +
      "Solo acepta ids devueltos por buscar_procesos_secop.",
    parametros: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Ids de proceso a evaluar." },
      },
      required: ["ids"],
    },
    async ejecutar(args) {
      const evaluados = aLista(args["ids"]).map((id) => {
        const p = cache.get(id);
        if (!p) return { id_del_proceso: id, error: "id desconocido, busca primero con buscar_procesos_secop" };

        const texto = normalizar(`${p.nombre} ${p.descripcion}`);
        const excluida = perfil.palabrasExcluir.find((k) => texto.includes(normalizar(k)));
        if (excluida) {
          return { id_del_proceso: id, puntaje: 0, cumple: false, razones: [`contiene "${excluida}"`] };
        }

        const razones: string[] = [];
        let puntaje = 0;

        if (p.precioBaseCOP == null) {
          razones.push("presupuesto desconocido");
        } else if (p.precioBaseCOP >= perfil.presupuestoMinCOP && p.precioBaseCOP <= perfil.presupuestoMaxCOP) {
          puntaje += 40;
          razones.push(`presupuesto ${cop(p.precioBaseCOP)} dentro del rango`);
        } else {
          razones.push(`presupuesto ${cop(p.precioBaseCOP)} fuera del rango`);
        }

        if (perfil.departamentos.some((d) => claveDepartamento(d) === claveDepartamento(p.departamento))) {
          puntaje += 20;
          razones.push(`departamento ${p.departamento} cubierto`);
        } else {
          razones.push(`departamento ${p.departamento || "desconocido"} fuera de cobertura`);
        }

        const aciertos = perfil.palabrasClave.filter((k) => texto.includes(normalizar(k)));
        if (aciertos.length > 0) {
          puntaje += Math.min(30, aciertos.length * 15);
          razones.push(`coincide con ${aciertos.join(", ")}`);
        } else {
          razones.push("ninguna palabra clave aparece en el objeto");
        }

        if (perfil.modalidadesPreferidas.some((m) => normalizar(m) === normalizar(p.modalidad))) {
          puntaje += 10;
          razones.push(`modalidad preferida: ${p.modalidad}`);
        }

        return { id_del_proceso: id, puntaje, cumple: puntaje >= 60, razones };
      });
      return { evaluados };
    },
  };

  const leerDetalle: Herramienta = {
    nombre: "leer_detalle_proceso",
    descripcion:
      "Devuelve el detalle de un proceso (objeto, descripción, entidad, presupuesto) e intenta leer el texto " +
      "de su página pública en SECOP II. Úsala solo con los candidatos mejor puntuados. " +
      "Si la página no se puede leer, devuelve lo que hay y lo indica.",
    parametros: {
      type: "object",
      properties: { id_del_proceso: { type: "string" } },
      required: ["id_del_proceso"],
    },
    async ejecutar(args) {
      const id = String(args["id_del_proceso"] ?? "");
      const p = cache.get(id);
      if (!p) return { error: "id desconocido, busca primero con buscar_procesos_secop" };

      const base = {
        id_del_proceso: p.idDelProceso,
        referencia: p.referencia,
        entidad: p.entidad,
        ciudad: p.ciudad,
        departamento: p.departamento,
        objeto: p.nombre,
        descripcion: p.descripcion,
        modalidad: p.modalidad,
        tipo_de_contrato: p.tipoContrato,
        presupuesto: cop(p.precioBaseCOP),
        fase: p.fase,
        url: p.url,
      };

      if (!p.url) return { ...base, pliego: null, nota: "El proceso no trae URL pública." };
      try {
        const res = await fetchConReintentos(p.url, { headers: { Accept: "text/html" } }, 2);
        if (!res.ok) return { ...base, pliego: null, nota: `La página respondió HTTP ${res.status}.` };
        const plano = textoPlano(await res.text());
        if (plano.length < 200) {
          return { ...base, pliego: null, nota: "La página casi no trae texto. Usa la descripción." };
        }
        return { ...base, pliego: plano.slice(0, MAX_TEXTO_PLIEGO), truncado: plano.length > MAX_TEXTO_PLIEGO };
      } catch (err) {
        const motivo = err instanceof Error ? err.message : String(err);
        return { ...base, pliego: null, nota: `No se pudo leer la página: ${motivo}` };
      }
    },
  };

  const alertar: Herramienta = {
    nombre: "guardar_alerta",
    descripcion:
      "Registra la alerta final de UN proceso que sí vale la pena. Úsala solo con procesos ya evaluados y leídos. " +
      "Incluye resumen, riesgos concretos y documentos que la empresa debe reunir.",
    parametros: {
      type: "object",
      properties: {
        id_del_proceso: { type: "string" },
        prioridad: { type: "string", enum: ["alta", "media", "baja"] },
        resumen: { type: "string", description: "Qué pide la entidad, en dos o tres frases claras." },
        riesgos: {
          type: "array",
          items: { type: "string" },
          description: "Cláusulas o condiciones riesgosas. Vacío si no hay.",
        },
        documentos_requeridos: {
          type: "array",
          items: { type: "string" },
          description: "Documentos que la empresa debe reunir para presentarse.",
        },
        recomendacion: { type: "string", description: "Presentarse o no, y por qué." },
      },
      required: ["id_del_proceso", "prioridad", "resumen", "riesgos", "documentos_requeridos", "recomendacion"],
    },
    async ejecutar(args) {
      const id = String(args["id_del_proceso"] ?? "");
      const p = cache.get(id);
      if (!p) return { error: "id desconocido, busca primero con buscar_procesos_secop" };

      const alerta = {
        ts: new Date().toISOString(),
        id_del_proceso: id,
        entidad: p.entidad,
        objeto: p.nombre,
        presupuesto: cop(p.precioBaseCOP),
        url: p.url,
        prioridad: String(args["prioridad"] ?? "media"),
        resumen: String(args["resumen"] ?? ""),
        riesgos: aLista(args["riesgos"]),
        documentos_requeridos: aLista(args["documentos_requeridos"]),
        recomendacion: String(args["recomendacion"] ?? ""),
      };

      appendFileSync(join(config.outDir, "alertas.jsonl"), JSON.stringify(alerta) + "\n", "utf-8");

      const lineas = [
        `## [${alerta.prioridad.toUpperCase()}] ${alerta.entidad}: ${alerta.objeto}`,
        `- Proceso: ${alerta.id_del_proceso} | Presupuesto: ${alerta.presupuesto}`,
      ];
      if (alerta.url) lineas.push(`- Enlace: ${alerta.url}`);
      lineas.push(
        `- Resumen: ${alerta.resumen}`,
        `- Riesgos: ${alerta.riesgos.join("; ") || "ninguno detectado"}`,
        `- Documentos: ${alerta.documentos_requeridos.join("; ") || "sin lista"}`,
        `- Recomendación: ${alerta.recomendacion}`,
        "",
        "",
      );
      appendFileSync(join(config.outDir, "alertas.md"), lineas.join("\n"), "utf-8");

      return { ok: true, guardada: id };
    },
  };

  return [buscar, filtrar, leerDetalle, alertar];
}