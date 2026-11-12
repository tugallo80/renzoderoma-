# Orígenes de cada número

La herramienta `armar_borrador` (la misma del Agente IA de la app) **rechaza** las filas sin origen válido y verifica que lo
citado exista. Formatos:

| Origen | Formato | Para | Lo verifica |
|---|---|---|---|
| 3D | `pieza3d:<adjunto>/<p1,p2>` + `medida` (`m2_cara`, `m2_sup`, `ml_perimetro`, `ml_largo`, `und`, `m3`, `glb`) | cantidades | que la pieza exista en la medición; la cantidad la calcula la herramienta |
| Base | `base:<materiales\|mano_obra\|oficios\|rendimientos>/<CLAVE>` | precios, rendimientos | que la clave exista; con `clave` el precio sale SIEMPRE de la base |
| Plano o foto | `cota_plano:<adjunto> p.<n> "<texto tal cual>"` | cantidades, medidas, precios escritos | que el adjunto sea PDF o imagen del proyecto y que la cita tenga el número |
| Dueño | `dueño:<id>` | lo que él dijo | que `<id>` sea un mensaje del dueño en esta conversación (`registrar_mensaje_del_dueno`) |
| Supuesto | `supuesto:<explicación>` + `geometria` `[{desc, cant, largo_m, ancho_m?}]` + `medida` | solo cantidades de tu propuesta constructiva | la cuenta la hace la herramienta; queda "sin confirmar" hasta `confirmar_supuestos` |

No valen: `calculo:`, texto libre, ni un `supuesto:` como origen de un precio.

## Ejemplos

```json
{"op":"fila","item":"Mostrador","tipo":"mat","d":"MDF blanco 18 mm","clave":"MDF_18","origen_q":"pieza3d:-Nadj1/p1,p2","medida":"m2_cara"}
{"op":"fila","item":"Letrero","tipo":"mat","d":"Canto PVC","clave":"CANTO_PVC","q":6.4,"origen_q":"cota_plano:-Nadj2 p.3 \"6,40 ml\""}
{"op":"fila","item":"Bastidor","tipo":"mat","d":"Tubo 20x40","clave":"TUBO_20X40","origen_q":"supuesto:marco perimetral con travesaño cada 1 m","geometria":[{"desc":"largueros","cant":2,"largo_m":5},{"desc":"montantes","cant":6,"largo_m":3}],"medida":"ml_largo"}
{"op":"fila","item":"Bastidor","tipo":"mat","d":"Tubo 20x40","clave":"TUBO_20X40","q":28,"stock_q":10,"origen_q":"dueño:-Nmsg4","origen_stock":"dueño:-Nmsg4"}
{"op":"fila","item":"Bastidor","tipo":"mo","d":"Armado y soldadura","cerrado":true,"p":1000,"origen_q":"dueño:-Nmsg5","origen_p":"dueño:-Nmsg5","oficio":"Don Pedro"}
```

Registrá **textual** lo que dijo el dueño: si dijo "son 3 adhesivos", eso; nunca un número que él no dijo.
