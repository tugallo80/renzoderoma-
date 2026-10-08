# Rubik Agent — Instalación en Windows

## 1. Instalar Python
Si no tenés Python: https://www.python.org/downloads/
Marcar "Add Python to PATH" al instalar.

## 2. Instalar dependencias
Abrí CMD en esta carpeta y ejecutá:
```
pip install -r requirements.txt
```

## 3. Conseguir API Key de Gemini (gratis)
1. Ir a https://aistudio.google.com/
2. Crear o iniciar sesión con cuenta Google
3. Click en "Get API Key" → "Create API Key"
4. Copiar la key (empieza con "AIza...")

## 4. Ejecutar
```
python agent.py
```

## Uso
1. Pegá tu API Key en el campo de arriba
2. Escribí la tarea en castellano (ej: "En Vectorworks, creá un rectángulo de 3x2m")
3. Click en ▶ Ejecutar
4. El agente toma el control del mouse y ejecuta paso a paso

## Teclas de control
- **F9** — Detener de emergencia
- **⏸ Pausar** — Pausar/Reanudar
- **Mover mouse a esquina sup-izquierda** — Detención de emergencia (pyautogui failsafe)

## Ejemplos de tareas
- "En Vectorworks, dibujá un rectángulo de 3x2 metros, ponele el layer ESTRUCTURA"
- "Abrí rubikbolivia.com, creá un presupuesto para un bastidor de lona 3x2m con estructura de tubo 20x20"
- "En Vectorworks, seleccioná todos los objetos y exportalos como DXF en el escritorio"
- "Buscá en Google 'precio tubin 20x20 Bolivia' y copiá el primer precio que aparezca"

## ¿Cómo funciona?
Cada paso:
1. Captura la pantalla
2. La manda a Gemini Vision con la tarea
3. Gemini decide la próxima acción (click, escribir, hotkey, scroll)
4. El agente ejecuta y repite hasta terminar (máx 40 pasos)
