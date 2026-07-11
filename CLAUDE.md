# Rubik Bolivia — Reglas de Oro para Claude

## PR y Deploy

1. **Siempre crear el PR automáticamente** después de cada push — sin esperar que el usuario lo pida. Ya tienes todos los accesos.

2. **Siempre mergear el PR automáticamente** después de crearlo — usar `mcp__github__merge_pull_request` con `merge_method: "squash"` al rama `main`. El deploy a Firebase se dispara solo al mergear.

3. El deploy solo ocurre cuando se mergea a `main` via la GitHub Action "Deploy to Firebase on merge". Nunca queda código pendiente de deploy.

## Proyecto

- Firebase Hosting + Cloud Functions Gen 2 (us-central1)
- Rama de desarrollo: `claude/mobile-project-setup-check-7itnug`
- Repo: `tugallo80/renzoderoma-`
- App live: rubikbolivia.com
