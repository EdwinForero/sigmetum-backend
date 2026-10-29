// Excel en memoria (exceljs) y subida por POST /upload, compartidos por fecha-utc, upload-excel y aws-prefijo.
const request = require('supertest');
const ExcelJS = require('exceljs');

const HEADERS = ['Provincia', 'Municipio', 'Altitud Media', 'Sector Biogeográfico', 'Piso Bioclimático', 'Ombrotipo',
    'Naturaleza del Sustrato', 'Tipo de Serie', 'Serie de Vegetación', 'Vegetación Potencial', 'Especies Características'];

const fullRow = (provincia) => [provincia, 'Municipio', 100, 'Sector', 'Piso', 'Ombrotipo', 'Sustrato', 'Tipo', 'Serie', 'Vegetación', 'Especies'];

const makeXlsx = async (rows) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Hoja1');
    sheet.addRow(HEADERS);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await workbook.xlsx.writeBuffer());
};

// POST /upload con multipart real y token válido; devuelve { status, json }. `simulados` se carga solo aquí, para que
// los tests que usan el aws/awsS3connect.js real puedan requerir este archivo sin inyectar los espías de S3.
const subir = async (app, rows, token = require('./simulados').validToken) => {
    const res = await request(app).post('/api/v1/upload').set('Authorization', `Bearer ${token}`).attach('file', await makeXlsx(rows), 'datos.xlsx');
    return { status: res.status, json: res.type === 'application/json' ? res.body : null };
};

module.exports = { HEADERS, fullRow, makeXlsx, subir };
