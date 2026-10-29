const { DATA_FILE_NAME_PATTERN } = require('../config/s3Paths');

// Interpretación única del nombre de una versión (AAAA-MM-DD_vN.xlsx): usa DATA_FILE_NAME_PATTERN.
// Devuelve { date, version } (version como entero) o null si el nombre no es estándar.
const parseVersionName = (name) => {
    const match = DATA_FILE_NAME_PATTERN.exec(name);
    return match ? { date: match[1], version: parseInt(match[2], 10) } : null;
};

// Última versión de una lista [{ name, key }]: mayor fecha y, a igual fecha, mayor N entero; si también
// coincide N (_v7 y _v007), el nombre mayor por unidades de código, para no depender del orden del listado.
// Ignora los nombres no estándar; devuelve null si no hay ninguno.
const latestVersionFile = (files) => {
    let best = null;
    let bestParsed = null;
    for (const file of files) {
        const parsed = parseVersionName(file.name);
        if (!parsed) continue;
        const wins = !best
            || parsed.date > bestParsed.date
            || (parsed.date === bestParsed.date && (parsed.version > bestParsed.version
                || (parsed.version === bestParsed.version && file.name > best.name)));
        if (wins) {
            best = file;
            bestParsed = parsed;
        }
    }
    return best;
};

module.exports = { parseVersionName, latestVersionFile };
