# Cómputo Métrico

## Qué hace
Calculadora de cómputos métricos para un ítem del presupuesto. Permite acumular piezas con distintos modos de cálculo: Lineal (m), Área (m²), Planchas, Barras (6m), Peso (kg) y Volumen (m³). Suma todas las piezas y guarda el resultado como la cantidad del ítem en el presupuesto. En modo Planchas/Barras genera un plano de corte optimizado (bin packing) en canvas.

## Archivo principal
`public/computo.html`

## Cómo está armado
HTML/CSS/JS con Firebase Realtime DB y Storage. La optimización de corte (bin packing) se implementa en JavaScript puro y se dibuja en un `<canvas>`. Tiene un chat IA contextual (Gemini) para sugerir precios, calcular desperdicios o recomendar modulaciones. Recibe `?cid=&pid=&idx=` (para ítems del presupuesto) o `?type=&apuidx=` (para sub-ítems APU). Carga `/js/firecache.js`, `/js/auth-guard.js`.

## Estructura de datos en Firebase
- `/proyectos/$cid/$pid/presupuesto/items/$idx/measures/` — array de piezas acumuladas (modo, cantidad, largo, ancho, alto, descripción)
- `/proyectos/$cid/$pid/presupuesto/items/$idx/cant/` — cantidad final calculada (escrita al confirmar)
- Para sub-ítems APU: `/proyectos/$cid/$pid/presupuesto/items/$idx/apu/$type/$apuidx/measures/`

## Archivos principales
- `public/computo.html`
- `/js/firecache.js`
- `/js/auth-guard.js`

## Decisiones tomadas
- El cómputo es un módulo auxiliar que se abre desde el botón "CÓMPUTO" de cada ítem en `presupuesto.html`.
- Las medidas se guardan automáticamente al agregar cada pieza (no solo al confirmar), para no perder datos.
- El algoritmo de bin packing es Guillotine o First Fit Decreasing; optimiza la distribución de cortes para minimizar desperdicios.
- El "Confirmar" escribe la cantidad calculada de vuelta al ítem del presupuesto.

## Problemas conocidos y pendientes
- El plano de corte visual en canvas es orientativo; no tiene escala exacta ni exportación.
- El modo "Peso" requiere ingresar manualmente el factor kg/m del perfil; no hay tabla de perfiles metálicos integrada.
