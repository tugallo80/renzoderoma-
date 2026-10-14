# Rubik OS — Documentación de Módulos

> Índice de módulos del hub administrativo de Rubik Bolivia (rubikbolivia.com).  
> Generado en octubre 2026 a partir del código en `main`.

---

## Arquitectura general

**Stack:** Firebase Hosting + Cloud Functions Gen 2 (Node.js, us-central1).

**Proyecto Firebase:** `rubik-bolivia`  
- Realtime Database: `https://rubik-bolivia-default-rtdb.firebaseio.com`  
- Storage: `rubik-bolivia.firebasestorage.app`  
- Auth: Firebase Auth con email/password (usuarios internos) + anónimo (clientes)

**API key web (pública):** `AIzaSyDXYlofy31cDP14xVAVxWo_7TqXdSgsIjA`

**Cloud Functions (todos bajo `/api/` vía Hosting rewrites):**

| Ruta | Función | Propósito |
|------|---------|-----------|
| `/api/gemini` | `geminiProxy` | IA de texto (Claude) + imagen (Gemini). Requiere Auth Bearer. |
| `/api/ingesta` | `procesarIngestaIA` | Carga masiva de materiales/APU/MO vía Claude |
| `/api/whatsapp` | `whatsappWebhook` | Bot WhatsApp (Meta webhook) |
| `/api/imagen` | `proxyImagen` | Proxy de imágenes externas |
| `/api/tts` | `ttsProxy` | Text-to-speech |
| `/api/gemini-live-key` | `geminiLiveKey` | Devuelve API key de Gemini Live para WebSocket directo |
| `/api/mail/*` | `mailFolders/Inbox/Message/Send` | IMAP/SMTP Zoho (dominio propio) |

Fuera de `/api/`: `kayApi` (URL directa `us-central1-rubik-bolivia.cloudfunctions.net/kayApi`) — API para Kay, el asistente personal; solo la puede invocar la cuenta de servicio de Kay. Ver [`../integracion-kay-trabajo.md`](../integracion-kay-trabajo.md).

**Deploy:** GitHub Action `firebase-hosting-merge.yml` dispara `firebase deploy` al mergear a `main`. Solo se despliega mergeando a `main` — nunca con `firebase deploy` directo.

**Estructura de datos en Realtime Database (paths raíz):**

```
/proyectos/$cid/$pid/          ← datos por cliente+proyecto
  presupuesto/                 ← ítems del presupuesto
  produccion/                  ← APU (materiales + MO por ítem)
  disenos/                     ← galería de diseños/fotos
  gantt/                       ← tareas del cronograma
  compras/                     ← órdenes de compra
  licitaciones/                ← licitaciones y asignaciones
  requerimientos/              ← requerimientos asistidos
  monto_cierre/                ← total aprobado
  presupuesto_total/           ← total calculado
  portada/                     ← configuración de portada PDF
/clientes/$cid/                ← perfil de cada cliente
/base_datos/                   ← catálogos globales
  materiales/                  ← catálogo de materiales
  mano_obra/                   ← catálogo de MO
  items/                       ← historial de ítems cotizados
  otros/                       ← gastos generales
  unidades/                    ← unidades de medida personalizadas
  proveedores/                 ← directorio de proveedores
/personal/                     ← datos del personal interno
/config_ia/                    ← prompts y configuración de IA
  prompts/                     ← prompts por módulo (editables desde ⚙️)
  custom_tags/                 ← etiquetas dinámicas de prompt
/notificaciones/hub/           ← notificaciones push internas
/feed_actividad/               ← feed de actividad global
/gantt/                        ← cronogramas (raíz alternativa)
/supervisores/                 ← perfiles de supervisores
/portafolio/                   ← portafolio público
/caja_chica/                   ← registros de caja chica
/requerimientos_asistidos/     ← requerimientos globales
/whatsapp_historial/           ← historial de conversaciones WA
/whatsapp_clientes/            ← vinculación WA-cliente
```

**Librerías JS compartidas (`/public/js/`):**
- `firecache.js` — wrapper Firebase con caché local (evita re-lecturas)
- `auth-guard.js` — redirige a login si no hay sesión activa
- `gemini-client.js` — cliente IA autenticado (llama `/api/gemini` con Bearer token)
- `gemini-live.js` — cliente WebSocket para Gemini Live (conversación de voz)
- `cerebro-live.js` — motor del Cerebro Ejecutivo (IA conversacional)
- `apu-utils.js` — utilidades compartidas de APU/presupuesto
- `viewmode.js` — modo oscuro y preferencias de vista
- `voice-utils.js` — utilidades de grabación de voz

---

## Índice de módulos

| Módulo | Archivo | Descripción corta |
|--------|---------|-------------------|
| [Hub Principal](./index.md) | `index.html` | Pantalla de inicio con cards de navegación y Cerebro Ejecutivo |
| [Clientes & Proyectos](./clientes.md) | `clientes.html` | Directorio de clientes y creación de proyectos |
| [Presupuesto](./presupuesto.md) | `presupuesto.html` | Cotización maestro con IA, importación de PDFs y exportación |
| [Producción (APU)](./produccion.md) | `produccion.html` | Análisis de Precios Unitarios por ítem de presupuesto |
| [Tesorería](./tesoreria.md) | `tesoreria.html` | Finanzas: ingresos, egresos, caja, planillas, SIAT |
| [Dashboard Proyecto](./dashboard-proyecto.md) | `dashboard-proyecto.html` | Vista ejecutiva de un proyecto: estado, KPIs, actividad |
| [Base de Datos](./base_datos.md) | `base_datos.html` | Catálogos de materiales, MO, ítems y proveedores |
| [Gantt](./gantt.md) | `gantt.html` | Cronograma Gantt con IA y asignación de personal |
| [Diseños y Archivos](./disenos.md) | `disenos.html` | Galería de diseños, renders y archivos de proyecto |
| [CAD](./cad.md) | `cad.html` | Editor CAD 2D/3D en browser para bocetos y presupuestos rápidos |
| [Correo](./correo.md) | `correo.html` | Cliente de correo Zoho integrado con IA |
| [Supervisor de Obra](./supervisor-obra.md) | `supervisor-obra.html` | App de supervisores: avance, fotos, reportes |
| [Portal Cliente](./cliente-view.md) | `cliente-view.html` | Vista del cliente: presupuesto, estado, aprobación |
| [Proyectos Cliente](./proyectos-cliente.md) | `proyectos-cliente.html` | Lista de proyectos de un cliente (panel interno) |
| [Portafolio Admin](./portafolio-admin.md) | `portafolio-admin.html` | Gestión del portafolio público de rubikbolivia.com |
| [Agencia](./agencia.md) | `agencia.html` | Presupuesto de servicios de agencia/diseño gráfico |
| [Compras](./compras.md) | `compras.html` | Órdenes de compra, pagos a proveedores, escaneo de facturas |
| [Licitaciones](./licitaciones.md) | `licitaciones.html` | Licitaciones y asignación de trabajos a subcontratistas |
| [Cómputo Métrico](./computo.md) | `computo.html` | Cómputo métrico asistido por IA desde imágenes/planos |
| [Requerimiento Asistido](./requerimiento-asistido.md) | `requerimiento-asistido.md` | Generación de requerimientos de materiales desde presupuesto |
| [App Trabajador](./app-trabajador.md) | `interno/app-trabajador.html` | App interna para trabajadores: tareas y partes diarios |
| [Herramientas](./herramientas.md) | `herramientas.html` | Descargas: Rubik Agent (automatización de escritorio) |
