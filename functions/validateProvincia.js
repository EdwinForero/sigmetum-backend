const { PROVINCIA_MAX_LENGTH, PROVINCIA_WORD_PATTERN, PROVINCIA_RESERVED } = require('../config/s3Paths');

// Nombres de propiedades de objeto que no pueden ser carpeta (la provincia se usa como clave de un objeto en GET /list-files).
const OBJECT_PROPERTY_NAMES = [...Object.getOwnPropertyNames(Object.prototype), 'prototype'];

// Lista de permitidos para el nombre de una provincia que acabará en una clave de S3. Recibe el valor ya recortado y en NFC.
// Devuelve null si es válido o un mensaje fijo. La longitud va antes de ejecutar la expresión.
const getProvinciaNameError = (name) => {
    if (name === undefined || name === null || name === '') return 'Province is required';
    if (typeof name !== 'string') return 'Province is not valid';
    if (name.length > PROVINCIA_MAX_LENGTH) return 'Province is not valid';
    if (!name.split(/[ -]/).every((word) => PROVINCIA_WORD_PATTERN.test(word))) return 'Province is not valid';
    if (OBJECT_PROPERTY_NAMES.includes(name)) return 'Province is not valid';
    const lower = name.toLowerCase();
    if (PROVINCIA_RESERVED.includes(name) || lower.startsWith('active') || lower.startsWith('terms')) return 'Province is reserved';
    return null;
};

// La celda de texto se recorta y se normaliza a NFC; cualquier otro tipo (número, array) pasa tal cual y se rechaza.
const normalizeCell = (value) => (typeof value === 'string' ? value.trim().normalize('NFC') : value);

// Provincia de un Excel ya convertido: la primera fila fija la provincia y el resto de filas que traigan la columna
// deben coincidir. Devuelve { provincia } o { error }.
const validateProvincia = (rows) => {
    const first = Array.isArray(rows) ? rows[0] : undefined;
    const provincia = normalizeCell(first ? first['Provincia'] : undefined);
    const error = getProvinciaNameError(provincia);
    if (error) return { error };
    for (const row of rows.slice(1)) {
        if (Object.prototype.hasOwnProperty.call(row, 'Provincia') && normalizeCell(row['Provincia']) !== provincia) {
            return { error: 'Excel contains more than one province' };
        }
    }
    return { provincia };
};

module.exports = { getProvinciaNameError, validateProvincia };
