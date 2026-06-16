# Protocolo Git - Rubik Proyecto

## Al inicio de cada sesión en Cowork (desde PC):
```
cd C:\RUBIK_PROYECTO && git pull origin main --no-rebase --no-edit
```

## Al final de cada sesión:
```
cd C:\RUBIK_PROYECTO
git add -A
git commit -m "descripción"
git push origin master:main
```

## Si hay conflicto (rejected):
```
git pull origin main --no-rebase --no-edit
git push origin master:main
```
