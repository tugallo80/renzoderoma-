# Rubik Bolivia — Reglas de Oro para Claude

## PR y Deploy

1. **Siempre crear el PR automáticamente** después de cada push — sin esperar que el usuario lo pida. Ya tienes todos los accesos.

2. **Siempre mergear el PR automáticamente** después de crearlo — usar `mcp__github__merge_pull_request` con `merge_method: "squash"` al rama `main`. El deploy a Firebase se dispara solo al mergear.

3. El deploy solo ocurre cuando se mergea a `main` via la GitHub Action "Deploy to Firebase on merge". Nunca queda código pendiente de deploy.

## Idioma

Responder siempre en **español** — en el chat, mensajes de commit y descripciones de PR.

## Integración con Kay

`functions/kay-api.js` (`kayApi`) es la API que usa Kay (asistente personal, repo `tugallo80/desarrollo-personal`).
Solo la invoca la cuenta de servicio de Kay (IAM + verificación en código). Para sumar una función: entrada nueva en
`ACCIONES`. Detalle en `docs/integracion-kay-trabajo.md`.

## Proyecto

- Firebase Hosting + Cloud Functions Gen 2 (us-central1)
- Rama de desarrollo: `claude/mobile-project-setup-check-7itnug`
- Repo: `tugallo80/renzoderoma-`
- App live: rubikbolivia.com
