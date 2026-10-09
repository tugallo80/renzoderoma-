"""
Rubik Agent — Agente de computer use para Vectorworks + cotización
Controla mouse y teclado guiado por IA (via rubikbolivia.com).

Requisitos:
    pip install pyautogui pillow requests

Uso:
    python agent.py

Tecla de emergencia: F9 para pausar/detener el agente.
"""

import tkinter as tk
from tkinter import scrolledtext, ttk
import threading
import time
import json
import base64
import io
import requests
import pyautogui
import sys

try:
    from PIL import ImageGrab, Image
except ImportError:
    print("Instalá Pillow: pip install pillow")
    sys.exit(1)

# ── Configuración ──────────────────────────────────────────────────────────────

FIREBASE_API_KEY = "AIzaSyDXYlofy31cDP14xVAVxWo_7TqXdSgsIjA"
FIREBASE_AUTH_URL = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={FIREBASE_API_KEY}"
PROXY_URL = "https://rubikbolivia.com/api/gemini"

SYSTEM_PROMPT = """Sos un agente de automatización que controla la computadora del usuario.
Tu objetivo es completar la tarea indicada usando el mouse y teclado.
En cada paso recibís una captura de pantalla y devolvés UNA sola acción en JSON.

FORMATO DE RESPUESTA — solo JSON, sin texto extra:
{
  "action": "click" | "right_click" | "double_click" | "type" | "hotkey" | "scroll" | "move" | "screenshot" | "done" | "fail",
  "x": <número, para acciones con posición>,
  "y": <número, para acciones con posición>,
  "text": "<texto a escribir, solo para action=type>",
  "keys": ["ctrl", "s"],  <- solo para action=hotkey (ej: ctrl+z, ctrl+c, enter, escape, tab, delete)
  "direction": "up" | "down",  <- solo para scroll
  "amount": 3,                 <- cantidad de scrolls
  "reason": "<qué estás haciendo y por qué>",
  "progress": "<qué lograste hasta ahora>"
}

REGLAS:
- Devolvé SOLO el JSON, nada más antes ni después
- Una acción por respuesta
- Usá "done" cuando completaste la tarea
- Usá "fail" si es imposible o algo salió muy mal
- Antes de hacer click en algo, verificá que existe en la pantalla
- Si necesitás más contexto, usá action=screenshot para ver la pantalla actualizada
- Para escribir texto en un campo, primero hacé click en el campo
- Las coordenadas x,y son píxeles desde la esquina superior izquierda de la pantalla
"""

pyautogui.FAILSAFE = True   # mover mouse a esquina sup-izq = emergencia
pyautogui.PAUSE = 0.3       # pausa entre acciones

# ── Estado global del agente ───────────────────────────────────────────────────

_running = False
_pause_event = threading.Event()
_pause_event.set()
_log_callback = None
_id_token = ""
_token_expiry = 0  # timestamp unix

# ── Autenticación Firebase ────────────────────────────────────────────────────

def firebase_login(email, password):
    """Autenticarse con Firebase y obtener ID token. Devuelve (token, expires_in)."""
    resp = requests.post(FIREBASE_AUTH_URL, json={
        "email": email,
        "password": password,
        "returnSecureToken": True
    }, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise Exception(data["error"].get("message", "Error de autenticación"))
    token = data["idToken"]
    expires_in = int(data.get("expiresIn", 3600))
    return token, expires_in

# ── Captura de pantalla ────────────────────────────────────────────────────────

def capture_screen(region=None):
    """Captura pantalla completa o región (x,y,w,h) y devuelve base64 JPEG."""
    img = ImageGrab.grab(bbox=region)
    max_w = 1280
    if img.width > max_w:
        ratio = max_w / img.width
        img = img.resize((max_w, int(img.height * ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode()

# ── Llamada al proxy ───────────────────────────────────────────────────────────

def ask_ai(task, screenshot_b64, history, id_token):
    history_text = ""
    if history:
        history_text = "\n\nHISTORIAL DE ACCIONES ANTERIORES:\n" + "\n".join(
            f"- {h}" for h in history[-8:]
        )

    user_content = [
        {"text": f"TAREA: {task}{history_text}\n\nEsta es la captura actual de la pantalla. Decidí la próxima acción:"},
        {"inlineData": {"mimeType": "image/jpeg", "data": screenshot_b64}}
    ]

    payload = {
        "model": "gemini-2.5-flash",
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": user_content}],
        "generationConfig": {"maxOutputTokens": 512, "temperature": 0.1}
    }

    resp = requests.post(
        PROXY_URL,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {id_token}"
        },
        timeout=90
    )
    resp.raise_for_status()
    data = resp.json()
    raw = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    return json.loads(raw.strip())

# ── Ejecutor de acciones ───────────────────────────────────────────────────────

def execute_action(action_obj):
    a = action_obj.get("action", "")
    x = action_obj.get("x")
    y = action_obj.get("y")

    if a == "click":
        pyautogui.click(x, y)
    elif a == "right_click":
        pyautogui.rightClick(x, y)
    elif a == "double_click":
        pyautogui.doubleClick(x, y)
    elif a == "move":
        pyautogui.moveTo(x, y, duration=0.3)
    elif a == "type":
        text = action_obj.get("text", "")
        pyautogui.write(text, interval=0.04)
    elif a == "hotkey":
        keys = action_obj.get("keys", [])
        if keys:
            pyautogui.hotkey(*keys)
    elif a == "scroll":
        direction = action_obj.get("direction", "down")
        amount = action_obj.get("amount", 3)
        clicks = amount if direction == "up" else -amount
        if x and y:
            pyautogui.scroll(clicks, x=x, y=y)
        else:
            pyautogui.scroll(clicks)
    elif a == "screenshot":
        pass
    elif a in ("done", "fail"):
        pass

# ── Loop principal del agente ──────────────────────────────────────────────────

def run_agent(task, id_token, log, on_done):
    global _running
    _running = True
    history = []
    max_steps = 40

    log(f"▶ Iniciando tarea: {task}\n")

    for step in range(max_steps):
        if not _running:
            log("⏹ Agente detenido.\n")
            break

        _pause_event.wait()

        log(f"── Paso {step + 1} ──────────────────────────")

        try:
            ss = capture_screen()
        except Exception as e:
            log(f"❌ Error capturando pantalla: {e}\n")
            break

        try:
            action = ask_ai(task, ss, history, id_token)
        except json.JSONDecodeError as e:
            log(f"❌ Respuesta inválida de IA: {e}\n")
            break
        except Exception as e:
            log(f"❌ Error de API: {e}\n")
            break

        a_type   = action.get("action", "?")
        reason   = action.get("reason", "")
        progress = action.get("progress", "")

        log(f"  🤖 Acción: {a_type}")
        if action.get("x") and action.get("y"):
            log(f"     @ ({action['x']}, {action['y']})")
        if action.get("text"):
            log(f"     texto: {repr(action['text'])}")
        if action.get("keys"):
            log(f"     teclas: {'+'.join(action['keys'])}")
        if reason:
            log(f"     razón: {reason}")
        if progress:
            log(f"     progreso: {progress}")

        history.append(f"Paso {step+1}: {a_type} — {reason}")

        if a_type == "done":
            log(f"\n✅ Tarea completada.\n")
            break
        elif a_type == "fail":
            log(f"\n❌ El agente no pudo completar la tarea.\n")
            break

        try:
            execute_action(action)
        except Exception as e:
            log(f"❌ Error ejecutando acción: {e}\n")
            break

        time.sleep(0.5)

    else:
        log(f"\n⚠ Límite de {max_steps} pasos alcanzado.\n")

    _running = False
    on_done()

# ── Interfaz gráfica ───────────────────────────────────────────────────────────

class RubikAgentUI:
    def __init__(self, root):
        self.root = root
        self._id_token = ""
        root.title("Rubik Agent 🤖")
        root.geometry("520x680")
        root.resizable(True, True)
        root.attributes("-topmost", True)

        # Login
        frm_login = tk.LabelFrame(root, text="Cuenta rubikbolivia.com", padx=10, pady=6)
        frm_login.pack(fill=tk.X, padx=10, pady=(8, 0))

        tk.Label(frm_login, text="Email:", font=("Arial", 10), width=8, anchor=tk.W).grid(row=0, column=0, sticky=tk.W)
        self.email_var = tk.StringVar()
        tk.Entry(frm_login, textvariable=self.email_var, width=30).grid(row=0, column=1, sticky=tk.EW, padx=4)

        tk.Label(frm_login, text="Contraseña:", font=("Arial", 10), width=8, anchor=tk.W).grid(row=1, column=0, sticky=tk.W, pady=2)
        self.pass_var = tk.StringVar()
        tk.Entry(frm_login, textvariable=self.pass_var, show="•", width=30).grid(row=1, column=1, sticky=tk.EW, padx=4)

        frm_login.columnconfigure(1, weight=1)

        self.btn_login = tk.Button(frm_login, text="Conectar", bg="#34c759", fg="white",
                                   font=("Arial", 10, "bold"), command=self.do_login, padx=12)
        self.btn_login.grid(row=2, column=0, columnspan=2, pady=(6, 2))

        self.lbl_status = tk.Label(frm_login, text="⬤ Sin conectar", fg="#888", font=("Arial", 9))
        self.lbl_status.grid(row=3, column=0, columnspan=2)

        # Tarea
        frm_task = tk.Frame(root, padx=10, pady=4)
        frm_task.pack(fill=tk.X)
        tk.Label(frm_task, text="Tarea:", font=("Arial", 10, "bold")).pack(anchor=tk.W)
        self.task_text = tk.Text(frm_task, height=4, font=("Arial", 10), wrap=tk.WORD)
        self.task_text.pack(fill=tk.X)
        self.task_text.insert("1.0",
            "Abrí Vectorworks, creá un rectángulo de 3x2 metros y guardá el archivo.")

        # Botones
        frm_btns = tk.Frame(root, padx=10, pady=6)
        frm_btns.pack(fill=tk.X)
        self.btn_start = tk.Button(frm_btns, text="▶ Ejecutar", bg="#5856d6", fg="white",
                                   font=("Arial", 11, "bold"), command=self.start_agent,
                                   padx=16, state=tk.DISABLED)
        self.btn_start.pack(side=tk.LEFT, padx=4)
        self.btn_pause = tk.Button(frm_btns, text="⏸ Pausar", command=self.toggle_pause,
                                   font=("Arial", 10), state=tk.DISABLED, padx=10)
        self.btn_pause.pack(side=tk.LEFT, padx=4)
        self.btn_stop = tk.Button(frm_btns, text="⏹ Detener", bg="#ff453a", fg="white",
                                  command=self.stop_agent, font=("Arial", 10), state=tk.DISABLED, padx=10)
        self.btn_stop.pack(side=tk.LEFT, padx=4)
        tk.Label(frm_btns, text="F9 = emergencia", fg="gray", font=("Arial", 9)).pack(side=tk.RIGHT)

        # Progreso
        self.progress = ttk.Progressbar(root, mode="indeterminate")
        self.progress.pack(fill=tk.X, padx=10, pady=2)

        # Log
        tk.Label(root, text="Log de acciones:", font=("Arial", 10), anchor=tk.W).pack(fill=tk.X, padx=10)
        self.log_area = scrolledtext.ScrolledText(root, height=20, font=("Courier", 9),
                                                   bg="#1c1c1e", fg="#e8e8e8", insertbackground="white")
        self.log_area.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        root.bind("<F9>", lambda e: self.stop_agent())
        _pause_event.set()

    def log(self, msg):
        def _do():
            self.log_area.insert(tk.END, msg + "\n")
            self.log_area.see(tk.END)
        self.root.after(0, _do)

    def do_login(self):
        email = self.email_var.get().strip()
        password = self.pass_var.get()
        if not email or not password:
            self.lbl_status.config(text="⬤ Ingresá email y contraseña", fg="#ff453a")
            return
        self.btn_login.config(state=tk.DISABLED, text="Conectando…")
        self.lbl_status.config(text="⬤ Autenticando…", fg="#ff9f0a")

        def _do_login():
            try:
                token, _ = firebase_login(email, password)
                self._id_token = token
                self.root.after(0, lambda: self._on_login_ok(email))
            except Exception as e:
                self.root.after(0, lambda: self._on_login_err(str(e)))

        threading.Thread(target=_do_login, daemon=True).start()

    def _on_login_ok(self, email):
        self.lbl_status.config(text=f"⬤ Conectado: {email}", fg="#34c759")
        self.btn_login.config(text="Reconectar", state=tk.NORMAL)
        self.btn_start.config(state=tk.NORMAL)
        self.log(f"✅ Autenticado como {email}\n")

    def _on_login_err(self, msg):
        self.lbl_status.config(text=f"⬤ Error: {msg}", fg="#ff453a")
        self.btn_login.config(text="Conectar", state=tk.NORMAL)
        self.log(f"❌ Error de login: {msg}\n")

    def start_agent(self):
        global _running
        if _running:
            return
        if not self._id_token:
            self.log("❌ Conectate primero con tu cuenta de rubikbolivia.com.\n")
            return
        task = self.task_text.get("1.0", tk.END).strip()
        if not task:
            return

        self.log_area.delete("1.0", tk.END)
        self.btn_start.config(state=tk.DISABLED)
        self.btn_pause.config(state=tk.NORMAL)
        self.btn_stop.config(state=tk.NORMAL)
        self.progress.start(12)
        _pause_event.set()

        threading.Thread(
            target=run_agent,
            args=(task, self._id_token, self.log, self.on_agent_done),
            daemon=True
        ).start()

    def toggle_pause(self):
        if _pause_event.is_set():
            _pause_event.clear()
            self.btn_pause.config(text="▶ Reanudar")
            self.log("⏸ Pausado. Presioná Reanudar para continuar.\n")
        else:
            _pause_event.set()
            self.btn_pause.config(text="⏸ Pausar")
            self.log("▶ Reanudado.\n")

    def stop_agent(self):
        global _running
        _running = False
        _pause_event.set()
        self.log("🛑 Detención solicitada…\n")

    def on_agent_done(self):
        def _do():
            self.btn_start.config(state=tk.NORMAL if self._id_token else tk.DISABLED)
            self.btn_pause.config(state=tk.DISABLED, text="⏸ Pausar")
            self.btn_stop.config(state=tk.DISABLED)
            self.progress.stop()
        self.root.after(0, _do)


def main():
    root = tk.Tk()
    app = RubikAgentUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
