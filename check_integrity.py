#!/usr/bin/env python3
"""
Verifica integridad de archivos HTML y JS antes del deploy.
Detecta truncamientos y funciones faltantes críticas.
Uso: python check_integrity.py
"""
import os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
errors = []

def check_file(path, checks):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        errors.append(f"MISSING FILE: {path}")
        return
    with open(full, 'r', encoding='utf-8') as f:
        content = f.read()
    for label, token in checks:
        if token not in content:
            errors.append(f"MISSING in {path}: {label} ({token[:60]})")

# ── tesoreria.html ──
check_file('public/tesoreria.html', [
    ('cierre HTML',             '</html>'),
    ('cierre script',           '</script>'),
    ('registrarFacturaCompra',  'window.registrarFacturaCompra'),
    ('syncFacturaCompraABD',    'syncFacturaCompraABD'),
    ('renderImpuestos',         'window.renderImpuestos'),
    ('_getMesesDelPeriodo',     '_getMesesDelPeriodo'),
    ('eliminarFacturaCompra',   'window.eliminarFacturaCompra'),
    ('escanearTodasLasFacturas','window.escanearTodasLasFacturas'),
    ('escanearFacturasVenta',   'window.escanearFacturasVenta'),
    ('escanearCobroBoucher',    'window.escanearCobroBoucher'),
    ('_fileToBase64',           '_fileToBase64'),
    ('adjuntarFotoFactura',     'window.adjuntarFotoFactura'),
    ('registrarCobro',          'window.registrarCobro'),
    ('registrarIngreso',        'window.registrarIngreso'),
    ('exportarRCVExcel',        'function exportarRCVExcel'),
    ('exportarAuditoriaPDF',    'async function exportarAuditoriaPDF'),
])

# ── clientes.html ──
check_file('public/clientes.html', [
    ('cierre HTML',      '</html>'),
    ('cierre script',    '</script>'),
    ('openAddModal',     'function openAddModal'),
    ('openNew',          'function openNew'),
    ('saveClient',       'async function saveClient'),
    ('generarCoverIA',   'async function generarCoverIA'),
    ('renderClients',    'function renderClients'),
    ('deleteCurrentClient', 'async function deleteCurrentClient'),
])

# ── functions/index.js ──
check_file('functions/index.js', [
    ('geminiProxy',        'exports.geminiProxy'),
    ('whatsappWebhook',    'exports.whatsappWebhook'),
    ('hub.verify_token',   'hub.verify_token'),
    ('enviarWA',           'async function enviarWA'),
    ('buildPrompt',        'function buildPrompt'),
    ('identificarRol',     'function identificarRol'),
    ('proxyImagen',        'exports.proxyImagen'),
])

if errors:
    print("\n❌ ERRORES DE INTEGRIDAD DETECTADOS:\n")
    for e in errors:
        print(f"  • {e}")
    print(f"\n{len(errors)} problema(s) encontrado(s). NO hacer deploy hasta corregir.\n")
    sys.exit(1)
else:
    print("✅ Todos los archivos íntegros. Listo para deploy.")
    sys.exit(0)
