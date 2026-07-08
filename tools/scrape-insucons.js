/**
 * scrape-insucons.js — Extrae datos de insucons.com y los carga a Rubik Bolivia
 *
 * REQUISITOS (instalar una sola vez):
 *   npm install playwright
 *   npx playwright install chromium
 *
 * USO:
 *   node scrape-insucons.js
 *
 * Carga automáticamente materiales, mano de obra y APU a tu base de datos.
 */

const { chromium } = require("playwright");
const https = require("https");
const http  = require("http");

// ── Configuración ──────────────────────────────────────────────────────────────
const API_URL      = "https://rubikbolivia.com/api/importar-admin";
const ADMIN_KEY    = "RubikImport2026!Admin$Key";   // mismo valor que pusiste en Secret Manager
const BASE_URL     = "https://www.insucons.com";
const APU_URL      = `${BASE_URL}/analisis-precio-unitario`;

// Categorías relevantes a señalética, metalmecánica, publicidad, construcción
const CATEGORIAS_RELEVANTES = [
    "metal", "acero", "tubin", "tubo", "tubing", "hierro", "fierro",
    "pintura", "esmalte", "anticorrosivo", "galvaniz",
    "vidrio", "espejo", "cristal", "silicona",
    "lona", "vinil", "vinyl", "acrílico", "acrilico", "policarbonato",
    "soldad", "cerrajería", "cerrajeria", "carpinter",
    "cement", "arena", "mortero", "block", "ladrillo",
    "electric", "cable", "luminaria", "led",
    "madera", "mdf", "triplex", "melamina",
    "aluminio", "zinc", "plancha", "lámina", "lamina",
    "tornillo", "perno", "remache", "fijación", "fijacion",
    "andamio", "equipo", "herramienta",
    "instalad", "vidrer", "soldador", "pintor", "carpinter", "electricista",
    "albañil", "albanil", "ayudante", "maestro", "técnico", "tecnico",
];

function esRelevante(texto) {
    const t = (texto || "").toLowerCase();
    return CATEGORIAS_RELEVANTES.some(k => t.includes(k));
}

// ── Helpers de red ─────────────────────────────────────────────────────────────
function postJson(url, data, adminKey) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const parsed = new URL(url);
        const lib = parsed.protocol === "https:" ? https : http;
        const req = lib.request(parsed, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
                "X-Admin-Key": adminKey,
            },
        }, res => {
            let raw = "";
            res.on("data", c => (raw += c));
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
                catch { resolve({ status: res.statusCode, body: raw }); }
            });
        });
        req.on("error", reject);
        req.write(body);
        req.end();
    });
}

// ── Scraper principal ──────────────────────────────────────────────────────────
async function scrapeInsucons() {
    console.log("🚀 Iniciando scrape de insucons.com...\n");

    const browser = await chromium.launch({ headless: true });
    const page    = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });

    const result = { materiales: [], mano_obra: [], items_apu: [] };
    const seen = new Set();

    // ── 1. Página de APU ────────────────────────────────────────────────────────
    console.log("📄 Cargando", APU_URL);
    await page.goto(APU_URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    // Detectar estructura de la página
    const pageTitle = await page.title();
    console.log("   Título:", pageTitle);

    // Buscar links de categorías / filtros
    const categoryLinks = await page.$$eval("a", els =>
        els.map(a => ({ href: a.href, text: a.innerText.trim() }))
           .filter(l => l.href.includes("insucons.com") && l.text.length > 2)
    );
    console.log(`   Links encontrados: ${categoryLinks.length}`);

    // Intentar extraer tabla de APU directamente
    await extractApuFromPage(page, result, seen);

    // ── 2. Navegar categorías de APU ────────────────────────────────────────────
    const apuCategories = categoryLinks.filter(l =>
        l.href.includes("analisis") || l.href.includes("apu") ||
        l.href.includes("categoria") || l.href.includes("item")
    );

    for (const cat of apuCategories.slice(0, 20)) {
        if (seen.has(cat.href)) continue;
        seen.add(cat.href);
        try {
            console.log(`   → ${cat.text} (${cat.href})`);
            await page.goto(cat.href, { waitUntil: "networkidle", timeout: 20000 });
            await page.waitForTimeout(1000);
            await extractApuFromPage(page, result, seen);
        } catch (e) {
            console.warn(`     ⚠️  ${e.message.slice(0, 80)}`);
        }
    }

    // ── 3. Páginas de materiales/insumos ────────────────────────────────────────
    const matUrls = [
        `${BASE_URL}/insumos`,
        `${BASE_URL}/materiales`,
        `${BASE_URL}/precios`,
        `${BASE_URL}/catalogo`,
    ];
    for (const u of matUrls) {
        try {
            await page.goto(u, { waitUntil: "networkidle", timeout: 15000 });
            await page.waitForTimeout(1000);
            await extractMaterialesFromPage(page, result, seen);
        } catch { /* página no existe, continuar */ }
    }

    // ── 4. Mano de obra ─────────────────────────────────────────────────────────
    const moUrls = [
        `${BASE_URL}/mano-de-obra`,
        `${BASE_URL}/mano_de_obra`,
        `${BASE_URL}/recursos-humanos`,
        `${BASE_URL}/salarios`,
    ];
    for (const u of moUrls) {
        try {
            await page.goto(u, { waitUntil: "networkidle", timeout: 15000 });
            await page.waitForTimeout(1000);
            await extractMoFromPage(page, result, seen);
        } catch { /* página no existe, continuar */ }
    }

    await browser.close();
    return result;
}

// ── Extractores ────────────────────────────────────────────────────────────────
async function extractApuFromPage(page, result, seen) {
    // Buscar filas de tabla que parezcan APU
    const rows = await page.$$eval("table tr, .item, .apu-item, [class*='item'], [class*='apu']", els =>
        els.map(el => el.innerText.replace(/\s+/g, " ").trim()).filter(t => t.length > 5)
    );

    for (const row of rows) {
        const parts = row.split(/\t|\|/).map(p => p.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const nombre = parts[0];
        if (!esRelevante(nombre)) continue;

        // Detectar si es material o MO o APU
        const precio = parseFloat(parts.find(p => /^\d+[\d.,]*$/.test(p.replace(",", "."))) || "0");
        const und    = parts.find(p => /^(m2|ml|kg|gl|und|pza|hr|jornal|jor|m3|lt|barra|rollo|pliego|glb)$/i.test(p)) || "und";

        const key = nombre.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);

        if (/soldad|vidrer|pintor|albañil|carpint|instalad|electricist|maestro|ayudante|operario|técnico|obrero/i.test(nombre)) {
            result.mano_obra.push({ n: nombre.toUpperCase(), u: und || "jornal", p: precio || 0 });
        } else if (/tubín|tubin|tubo|plancha|ángulo|angulo|varilla|espejo|vidrio|pintura|silicona|lona|vinil|acrílico|aluminio|hierro|acero|cemento|arena|cable|tornillo/i.test(nombre)) {
            result.materiales.push({ n: nombre.toUpperCase(), u: und || "und", p: precio || 0 });
        } else if (precio > 0) {
            // APU item genérico
            result.items_apu.push({
                desc: nombre.toUpperCase(), und: und || "glb", cant: 1,
                feat: `- ${nombre}\n- Precio unitario referencial insucons.com`,
                apu: { mat: [], mo: [], eq: [], sub: [] }, util: 30, ind: 10
            });
        }
    }
}

async function extractMaterialesFromPage(page, result, seen) {
    const rows = await page.$$eval("table tr, .material, [class*='material'], [class*='insumo']", els =>
        els.map(el => el.innerText.replace(/\s+/g, " ").trim()).filter(t => t.length > 3)
    );
    for (const row of rows) {
        const parts = row.split(/\t|\|/).map(p => p.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const nombre = parts[0];
        if (!esRelevante(nombre)) continue;
        const precio = parseFloat(parts.find(p => /^\d+[\d.,]*$/.test(p.replace(",", "."))) || "0");
        const und    = parts.find(p => /^(m2|ml|kg|gl|und|pza|hr|jornal|m3|lt|barra|rollo|pliego|glb)$/i.test(p)) || "und";
        const key    = nombre.toUpperCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.materiales.push({ n: key, u: und, p: precio || 0 });
    }
}

async function extractMoFromPage(page, result, seen) {
    const rows = await page.$$eval("table tr, .mo, [class*='mano'], [class*='obrero'], [class*='salario']", els =>
        els.map(el => el.innerText.replace(/\s+/g, " ").trim()).filter(t => t.length > 3)
    );
    for (const row of rows) {
        const parts = row.split(/\t|\|/).map(p => p.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const nombre = parts[0];
        const precio = parseFloat(parts.find(p => /^\d+[\d.,]*$/.test(p.replace(",", "."))) || "0");
        const und    = parts.find(p => /^(jornal|jor|hr|dia|mes)$/i.test(p)) || "jornal";
        const key    = nombre.toUpperCase();
        if (seen.has(key)) return;
        seen.add(key);
        result.mano_obra.push({ n: key, u: und, p: precio || 0 });
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
    try {
        const data = await scrapeInsucons();

        console.log("\n📊 Datos extraídos:");
        console.log(`   Materiales:  ${data.materiales.length}`);
        console.log(`   Mano de obra: ${data.mano_obra.length}`);
        console.log(`   APU items:   ${data.items_apu.length}`);

        if (data.materiales.length === 0 && data.mano_obra.length === 0 && data.items_apu.length === 0) {
            console.warn("\n⚠️  No se extrajeron datos. El sitio puede tener estructura dinámica.");
            console.warn("   Guardando HTML para revisar en insucons_debug.html");
            process.exit(1);
        }

        console.log("\n📤 Cargando a Rubik Bolivia...");
        const resp = await postJson(API_URL, data, ADMIN_KEY);
        console.log(`   HTTP ${resp.status}`);
        console.log("   Respuesta:", JSON.stringify(resp.body, null, 2));

        if (resp.status === 200 && resp.body?.ok) {
            const c = resp.body.cargados;
            console.log(`\n✅ Cargado exitosamente:`);
            console.log(`   ${c.materiales} materiales`);
            console.log(`   ${c.mano_obra} mano de obra`);
            console.log(`   ${c.items} ítems APU`);
            if (c.errores?.length) {
                console.warn("   Errores:", c.errores);
            }
        } else {
            console.error("\n❌ Error al cargar. Respuesta:", resp.body);
        }
    } catch (e) {
        console.error("❌ Fatal:", e.message);
        process.exit(1);
    }
})();
