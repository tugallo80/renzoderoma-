# Reclamo a Google — Consumo no autorizado de Gemini API

> **Cómo enviarlo:**
> 1. https://aistudio.google.com → menú del usuario (arriba a la derecha) → **Help** → **Send feedback** o **Contact support**.
> 2. Alternativa formal: https://console.cloud.google.com/support → **Create case** → categoría "Billing".
> 3. Si pagás Gemini con tarjeta personal y el monto es chico, abrí ticket directo en https://support.google.com/billing
>
> Adjuntá un screenshot del gráfico de uso (Google Cloud Console → Billing → Reports, filtrando por SKU "Generative Language API") que muestre los dos picos.

---

**Asunto:** Solicitud de revisión y crédito por consumo no autorizado de Gemini API — proyecto `rubik-bolivia`

Estimado equipo de Google,

Soy Renzo De Roma (`renzoderoma@gmail.com`), propietario del proyecto de Google Cloud **`rubik-bolivia`**. Les escribo para reportar un consumo no autorizado de la **Generative Language API (Gemini)** y solicitar una revisión del cargo correspondiente.

**Resumen del incidente**

En los últimos días detecté dos picos atípicos de consumo de la Generative Language API en mi proyecto. El nivel de uso fue completamente inconsistente con el tráfico real de mi aplicación (Rubik OS, alojada en `https://rubikbolivia.com`), que es una herramienta interna de gestión de proyectos de construcción con un volumen muy bajo de consultas diarias.

**Causa raíz identificada**

Tras la auditoría que realicé hoy, confirmé que una API key estaba accidentalmente embebida en archivos HTML servidos públicamente por Firebase Hosting. Cualquier visitante de la web podía leerla con "Ver código fuente". Esto explica los picos: la key fue extraída y usada por un tercero.

**Acciones de mitigación que ya tomé**

1. Revoqué las API keys expuestas en Google AI Studio.
2. Refactoricé toda la aplicación para que las llamadas a Gemini pasen por un Cloud Function autenticado con Firebase Auth, con la key en Secret Manager.
3. Restringí CORS a los dominios oficiales del proyecto.
4. Configuré alertas de presupuesto y cuotas de uso defensivas.
5. Audité y limpié otros materiales sensibles que estaban en la carpeta pública.

**Lo que solicito**

Pido amablemente que revisen los registros de consumo de los días [INDICAR LAS FECHAS DE LOS DOS PICOS] y consideren acreditar a mi cuenta el costo correspondiente a esas requests, dado que provienen de un uso no autorizado por mi parte y no del funcionamiento normal de la aplicación.

Quedo a disposición para enviar cualquier evidencia adicional que necesiten: registros de Firebase Hosting, IPs origen de los requests, fechas y horas exactas de los picos, o el commit de Git que muestra el refactor de seguridad ya realizado.

Muchas gracias por la atención.

Saludos cordiales,
**Renzo De Roma**
renzoderoma@gmail.com
Proyecto Google Cloud: `rubik-bolivia`
