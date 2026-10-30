# Aviso para PR: M23, la provincia solo admite escritura latina

Fecha: 2026-10-30 · Spec: [design](2026-10-30-m23-homoglifos-provincia-design.md) · Plan: [plan](2026-10-30-m23-homoglifos-provincia-plan.md)

## Qué cambia

`PROVINCIA_WORD_PATTERN` (`config/s3Paths.js`) pasa de «cualquier letra Unicode» a «letras latinas con diacríticos». Un nombre de provincia con una letra de otro alfabeto (por ejemplo, una a cirílica U+0430 o una alfa griega U+03B1 dentro de `Málaga`), un número romano o una marca combinante invisible da `400`:

- `POST /upload` (columna `Provincia` del Excel): `400` `Province is not valid`, sin escribir nada en S3 (ni versión ni borrador).
- `POST /upload/confirm`, `POST /update-file` y `POST /delete-file`: `400` `Invalid draftKey` / `Invalid fileName` si la provincia de la clave no cumple la regla.

Mismos estados, mismo envoltorio y mismo texto de error; solo hay casos nuevos de `400`. Siguen aceptándose los nombres latinos actuales (`Málaga`, `Santa Cruz de Tenerife`, `Castellón-Castelló`, `Ñ`).

**Límite aceptado**: dentro del latín siguen sin detectarse `I` mayúscula frente a `l` minúscula, ancho completo, `ª`, `º`, letras modificadoras, `ɑ`, `ɡ`, `ı`, `ſ`, `ᴀ`, ni se unifican `Málaga`/`Malaga`/`málaga`.

## Antes de desplegar

1. Listar `data/` en el bucket de **dev** y de **prod** y buscar carpetas cuyo nombre tenga caracteres no latinos (cirílico, griego u otros). Su existencia es desconocida **(por confirmar)**.
2. Si aparece alguna, migrarla a mano: renombrar la carpeta `data/<provincia>/` al nombre latino correcto y su `data/active/<provincia>.json`.
3. Si no se migra: la carpeta sigue visible en `GET /list-files`, pero `POST /update-file` y `POST /delete-file` darán `400` `Invalid fileName` (igual que F8 con NFD).

No hay código de migración en este cambio.

## Integración

- **Frontend (`sigmetum-frontend`)**: compatible, sin `/api/v2` (F12 en `docs/integracion/para-frontend.md`). Condición: carpetas existentes con caracteres no latinos (ver arriba). Que `FileUpload.js` y `FileDropdown` muestren bien el `400` está **(por confirmar)** contra su código. Orden de despliegue libre si no hay carpetas no latinas.
- **Infraestructura (`sigmetum-infra`)**: sin impacto (sin variables de entorno, permisos IAM ni endpoints nuevos). La migración manual del bucket la hace quien despliega.

## Para quien revisa

- Código: solo el valor de la constante exportada en `config/s3Paths.js`; `functions/validateProvincia.js` y `functions/validateDataKey.js` no cambian (una sola regla para el Excel y las tres rutas con clave).
- Pruebas: casos nuevos en `tests/provincia.test.js`, `tests/validadores.test.js`, `tests/upload-excel.test.js` y `tests/claves-cliente.test.js`, siempre con escapes `\u` (nunca el carácter crudo); `MIN_TESTS` sube a 1076.
- Documentos: `docs/05-modulos.md`, `docs/06-almacenamiento-s3.md`, `docs/guias/seguridad.md`, `docs/integracion/para-frontend.md`, `docs/07-estado-y-deuda-tecnica.md`.
