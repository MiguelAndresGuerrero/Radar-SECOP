# Radar SECOP

Agente autónomo que revisa los procesos de contratación abiertos en **SECOP II** y le avisa a una pyme colombiana solo de los que de verdad le convienen. Construido para el **Reto Agente 2026** (Platica.mx × Campuslands) sobre **Grok**.

## El problema

El Estado colombiano publica miles de procesos al mes en SECOP II. Una pyme que podría ganar muchos de ellos no tiene a nadie leyendo pliegos todos los días, y cuando alguien los lee suele descubrir tarde las cláusulas que hunden el margen: plazos imposibles, pólizas desproporcionadas, penalidades abiertas o experiencia exigida que la empresa no tiene.

El resultado: oportunidades que se pierden por no verlas a tiempo, y contratos que se firman sin entender el riesgo.

## Qué hace el agente

Recibe un objetivo ("revisa lo publicado esta semana y avísame lo que valga la pena") y un **perfil de empresa** (sector, presupuesto, departamentos, experiencia, capacidad financiera). Luego decide solo qué hacer:

1. **Busca** procesos abiertos recientes en la API de Datos Abiertos de SECOP II, una consulta por palabra clave del perfil.
2. **Filtra** los candidatos contra el perfil (presupuesto, cobertura, palabras clave, exclusiones, modalidad).
3. **Lee** el detalle de los mejores y analiza qué piden, si la empresa cumple y qué cláusulas son riesgosas.
4. **Alerta** únicamente de los que valen la pena, con resumen, riesgos y lista de documentos a reunir.

El modelo decide el orden, cuántas veces usar cada herramienta y cuándo parar. Si una herramienta falla, recibe el error como dato y se recupera solo.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `buscar_procesos_secop` | Consulta SECOP II (dataset `p6dx-8zbt`) por palabra clave, ventana de días y departamento |
| `filtrar_por_perfil` | Puntaje determinista 0-100 de encaje con el perfil, con razones |
| `leer_detalle_proceso` | Detalle del proceso y lectura best-effort de su página pública |
| `guardar_alerta` | Registra la alerta final en `out/alertas.md` y `out/alertas.jsonl` |

## Estructura

```
src/
  index.ts        punto de entrada (modo agente y modo --solo-secop)
  agent.ts        bucle del agente: tool calling sobre Grok, tope de pasos, bitácora
  secop.ts        cliente de SECOP II con timeout y reintentos con backoff
  tools/index.ts  las 4 herramientas
  config.ts       variables de entorno y perfil de la empresa
  log.ts          bitácora JSONL
config/perfil.example.json   perfil de ejemplo (editable)
out/                         alertas, resumen y bitácora de cada ejecución (no se versiona)
```

## Cómo correrlo

Requiere Node.js 20.12 o superior.

```bash
npm install
cp .env.example .env     # en Windows (PowerShell): Copy-Item .env.example .env
# edita .env y pon tu llave del reto en RETO_API_KEY
npm run start:secop      # prueba la conexión con SECOP II (no usa el modelo)
npm start                # corre el agente completo
```

El agente usa el SDK de OpenAI apuntando al gateway del reto, que replica la API de xAI:

```
RETO_BASE_URL=https://api.reto.pltk.mx/v1
RETO_MODEL=grok-4.7
```

**Nunca subas tu `.env` ni tu llave al repositorio.** El `.gitignore` ya excluye `.env`.

## Qué deja cada ejecución

- `out/alertas.md`: las oportunidades, listas para leer.
- `out/alertas.jsonl`: lo mismo en formato máquina.
- `out/resumen.md`: resumen del agente, pasos y tokens usados.
- `out/bitacora.jsonl`: cada llamada al modelo y cada herramienta, con duración y tokens (base del reporte de costo por tarea).

## Límites conocidos

- Las páginas públicas de SECOP II cargan su contenido con JavaScript, así que la lectura del pliego completo puede devolver poco texto. Cuando pasa, el agente lo declara y analiza solo con la descripción del dataset, sin inventar cláusulas. Leer los documentos adjuntos del pliego es trabajo pendiente.
- El filtro por presupuesto se hace en el cliente porque el campo `precio_base` llega como texto.

## Hitos del reto

- [ ] **S1 · Agente corriendo**: bucle completo contra Grok, repositorio público y este README.
- [ ] **S2 · Herramientas reales**: 3+ herramientas con manejo de errores, 10 ejecuciones y video de 2 minutos.
- [ ] **S3 · Datos reales**: set de evaluación de 30+ casos y reporte de costo por tarea.
- [ ] **S4 · Semana de carga**: 1.000 unidades de trabajo, 12 horas desatendido y bitácora completa.

## Licencia

MIT. Ver [LICENSE](LICENSE).