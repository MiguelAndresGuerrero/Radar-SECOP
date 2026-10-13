import { config } from "./config.js";

const BASE = "https://www.datos.gov.co/resource/p6dx-8zbt.json";

export interface Proceso {
  idDelProceso: string;
  referencia: string;
  entidad: string;
  nitEntidad: string;
  departamento: string;
  ciudad: string;
  nombre: string;
  descripcion: string;
  fase: string;
  estado: string;
  estadoApertura: string;
  modalidad: string;
  tipoContrato: string;
  precioBaseCOP: number | null;
  fechaPublicacion: string;
  url: string;
}

type Fila = Record<string, unknown>;

function texto(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function aProceso(f: Fila): Proceso {
  const urlObj = f["urlproceso"];
  const url =
    typeof urlObj === "object" && urlObj !== null && "url" in urlObj
      ? texto((urlObj as { url: unknown }).url)
      : texto(urlObj);
  const precio = Number.parseFloat(texto(f["precio_base"]));
  return {
    idDelProceso: texto(f["id_del_proceso"]),
    referencia: texto(f["referencia_del_proceso"]),
    entidad: texto(f["entidad"]),
    nitEntidad: texto(f["nit_entidad"]),
    departamento: texto(f["departamento_entidad"]),
    ciudad: texto(f["ciudad_entidad"]),
    nombre: texto(f["nombre_del_procedimiento"]),
    descripcion: texto(f["descripci_n_del_procedimiento"]),
    fase: texto(f["fase"]),
    estado: texto(f["estado_del_procedimiento"]),
    estadoApertura: texto(f["estado_de_apertura_del_proceso"]),
    modalidad: texto(f["modalidad_de_contratacion"]),
    tipoContrato: texto(f["tipo_de_contrato"]),
    precioBaseCOP: Number.isFinite(precio) ? precio : null,
    fechaPublicacion: texto(f["fecha_de_publicacion_del"]),
    url,
  };
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchConReintentos(
  url: string,
  init: RequestInit = {},
  intentos = 4,
): Promise<Response> {
  let ultimoError: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      ultimoError = err;
      if (i < intentos - 1) await dormir(2000 * 2 ** i);
    }
  }
  const motivo = ultimoError instanceof Error ? ultimoError.message : String(ultimoError);
  throw new Error(`Falló la petición tras ${intentos} intentos: ${motivo}`);
}

export interface BusquedaParams {
  palabraClave?: string;
  diasAtras: number;
  departamento?: string;
  limite: number;
}

export async function buscarProcesos(p: BusquedaParams): Promise<Proceso[]> {
  const desde = new Date(Date.now() - p.diasAtras * 86_400_000).toISOString().slice(0, 19);
  const condiciones = [
    `estado_de_apertura_del_proceso='Abierto'`,
    `fecha_de_publicacion_del >= '${desde}'`,
  ];
  if (p.departamento) {
    condiciones.push(`departamento_entidad='${p.departamento.replace(/'/g, "''")}'`);
  }

  const params = new URLSearchParams({
    $where: condiciones.join(" AND "),
    $order: "fecha_de_publicacion_del DESC",
    $limit: String(Math.min(Math.max(p.limite, 1), 100)),
  });
  if (p.palabraClave) params.set("$q", p.palabraClave);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (config.appToken) headers["X-App-Token"] = config.appToken;

  const res = await fetchConReintentos(`${BASE}?${params}`, { headers });
  if (!res.ok) {
    const cuerpo = (await res.text()).slice(0, 300);
    throw new Error(`SECOP II respondió HTTP ${res.status}: ${cuerpo}`);
  }
  const filas = (await res.json()) as Fila[];
  return filas.map(aProceso);
}