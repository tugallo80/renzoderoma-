/**
 * Imágenes en el resultado de las herramientas del conector (sesión 6, docs/sesiones/06-render-requerimiento.md).
 *
 * - png(): arma un PNG en el servidor, sin dependencias (zlib de Node).
 * - imagenDePrueba(): para la herramienta `prueba_imagen`. Dibuja un número de 4 cifras al azar que NO va en el texto:
 *   si Claude lo lee bien, claude.ai le pasa la imagen al modelo. Las esquinas tienen colores fijos para una segunda
 *   comprobación. Con `peso_kb` se agrega una franja de ruido (no se comprime) para medir el tamaño que aguanta.
 * No usa datos de la app ni llama a ninguna API.
 */
const zlib = require("zlib");
const crypto = require("crypto");

// ---------------------------------------------------------------- PNG mínimo (RGB, 8 bits, sin entrelazado)
const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function bloque(tipo, datos) {
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const td = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([largo, td, crc]);
}
/** pix: Buffer RGB de ancho*alto*3. */
function png(ancho, alto, pix) {
    const filas = Buffer.alloc((ancho * 3 + 1) * alto);
    for (let y = 0; y < alto; y++) {
        filas[y * (ancho * 3 + 1)] = 0; // filtro "ninguno"
        pix.copy(filas, y * (ancho * 3 + 1) + 1, y * ancho * 3, (y + 1) * ancho * 3);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        bloque("IHDR", ihdr), bloque("IDAT", zlib.deflateSync(filas, { level: 9 })), bloque("IEND", Buffer.alloc(0)),
    ]);
}

// ---------------------------------------------------------------- dibujo
// Cifras 5×7 (cada fila es un número de 5 bits)
const CIFRAS = {
    0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
    4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
    8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
};
function lienzo(ancho, alto, fondo) {
    const pix = Buffer.alloc(ancho * alto * 3);
    for (let i = 0; i < ancho * alto; i++) { pix[i * 3] = fondo[0]; pix[i * 3 + 1] = fondo[1]; pix[i * 3 + 2] = fondo[2]; }
    const rect = (x0, y0, w, h, c) => {
        for (let y = Math.max(0, y0); y < Math.min(alto, y0 + h); y++) {
            for (let x = Math.max(0, x0); x < Math.min(ancho, x0 + w); x++) { const p = (y * ancho + x) * 3; pix[p] = c[0]; pix[p + 1] = c[1]; pix[p + 2] = c[2]; }
        }
    };
    const texto = (s, x0, y0, tam, c) => {
        String(s).split("").forEach((ch, k) => {
            const f = CIFRAS[ch]; if (!f) return;
            f.forEach((fila, y) => { for (let x = 0; x < 5; x++) if (fila & (16 >> x)) rect(x0 + k * 6 * tam + x * tam, y0 + y * tam, tam, tam, c); });
        });
    };
    return { pix, rect, texto };
}

const ESQUINAS = { arriba_izquierda: "rojo", arriba_derecha: "verde", abajo_izquierda: "azul", abajo_derecha: "amarillo" };

/**
 * PNG de prueba con un código al azar. peso_kb (0–400): agrega ruido hasta acercarse a ese tamaño.
 * Devuelve { codigo, buffer, ancho, alto }.
 */
function imagenDePrueba(pesoKb) {
    const codigo = String(crypto.randomInt(1000, 10000));
    const ancho = 640;
    const ruidoBytes = Math.max(0, Math.min(400, Number(pesoKb) || 0)) * 1024;
    const filasRuido = Math.ceil(ruidoBytes / (ancho * 3));
    const alto = 360 + filasRuido;
    const L = lienzo(ancho, alto, [245, 245, 240]);
    const esq = 70;
    L.rect(0, 0, esq, esq, [220, 30, 30]);
    L.rect(ancho - esq, 0, esq, esq, [30, 170, 60]);
    L.rect(0, 360 - esq, esq, esq, [30, 70, 220]);
    L.rect(ancho - esq, 360 - esq, esq, esq, [240, 200, 20]);
    L.texto(codigo, 140, 110, 20, [20, 20, 20]);
    if (filasRuido) {
        const r = crypto.randomBytes(ancho * filasRuido * 3);
        r.copy(L.pix, ancho * 360 * 3);
    }
    return { codigo, buffer: png(ancho, alto, L.pix), ancho, alto };
}

module.exports = { png, imagenDePrueba, ESQUINAS, crc32 };
