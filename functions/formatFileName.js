// La fecha del nombre es el día UTC; `now` se inyecta para poder fijarla (misma fuente que getNextVersion).
function formatFileName(version = 1, now = new Date()) {
    return `${now.toISOString().slice(0, 10)}_v${version}.xlsx`;
}

module.exports = { formatFileName };
