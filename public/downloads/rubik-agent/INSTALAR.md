# Rubik Agent — Instalación en Windows

## 1. Instalar Python
Si no tenés Python: https://www.python.org/downloads/
Marcar "Add Python to PATH" al instalar.

## 2. Instalar dependencias
Abrí CMD en esta carpeta y ejecutá:
```
pip install -r requirements.txt
```

## 3. Ejecutar
```
python agent.py
```

## Uso
1. Ingresá tu **email y contraseña de rubikbolivia.com**
2. Click en **Conectar** — se autentica con tu cuenta (no necesitás API key)
3. Escribí la tarea en castellano
4. Click en ▶ Ejecutar
5. El agente toma el control del mouse y ejecuta paso a paso

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
1. Se autentica con tu cuenta de rubikbolivia.com via Firebase
2. Cada paso captura la pantalla
3. La manda al servidor de IA de rubikbolivia.com con la tarea
4. La IA decide la próxima acción (click, escribir, hotkey, scroll)
5. El agente ejecuta y repite hasta terminar (máx 40 pasos)
