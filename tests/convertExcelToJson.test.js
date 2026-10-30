// Pruebas de caracterización de convertExcelToJson con un libro real de exceljs en memoria.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { convertExcelToJson } = require('../functions/convertExcelToJson');

const CABECERA = ['Provincia', 'Municipio', 'Altitud Media', 'Sector Biogeográfico', 'Piso Bioclimático', 'Ombrotipo',
    'Naturaleza del Sustrato', 'Tipo de Serie', 'Serie de Vegetación', 'Vegetación Potencial', 'Especies Características'];

const libro = async (filas) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Datos');
    sheet.addRow(CABECERA);
    for (const fila of filas) sheet.addRow(fila);
    return Buffer.from(await workbook.xlsx.writeBuffer());
};
const completa = (extra = {}) => {
    const base = ['Málaga', 'Antequera', 400, 'Rondén', 'Mesomediterráneo', 'Seco', 'Calcáreo', 'Climatófila', 'Serie 1', 'Encinar', 'Quercus ilex'];
    return CABECERA.map((nombre, i) => (nombre in extra ? extra[nombre] : base[i]));
};

test('devuelve una fila por cada fila de datos con las columnas por posición', async () => {
    const { processedData, emptyFields } = await convertExcelToJson(await libro([completa()]));
    assert.equal(processedData.length, 1);
    assert.deepEqual(Object.keys(processedData[0]), CABECERA);
    assert.equal(processedData[0]['Provincia'], 'Málaga');
    assert.equal(processedData[0]['Altitud Media'], 400);
    assert.deepEqual(emptyFields, []);
});

test('las celdas vacías se omiten de la fila y se informan en emptyFields con su número de fila', async () => {
    const { processedData, emptyFields } = await convertExcelToJson(await libro([completa({ Municipio: null, Ombrotipo: '   ' })]));
    assert.equal('Municipio' in processedData[0], false);
    assert.equal('Ombrotipo' in processedData[0], false);
    assert.equal(emptyFields.length, 1);
    assert.equal(emptyFields[0].rowIndex, 2);
});

test('los valores con coma se convierten en lista recortada y sin elementos vacíos', async () => {
    const { processedData } = await convertExcelToJson(await libro([completa({ 'Especies Características': 'Quercus ilex,  Pistacia lentiscus , ,Olea europaea' })]));
    assert.deepEqual(processedData[0]['Especies Características'], ['Quercus ilex', 'Pistacia lentiscus', 'Olea europaea']);
});

test('una fórmula devuelve su resultado', async () => {
    const { processedData } = await convertExcelToJson(await libro([completa({ 'Altitud Media': { formula: '100+200', result: 300 } })]));
    assert.equal(processedData[0]['Altitud Media'], 300);
});

test('el texto enriquecido se concatena', async () => {
    const rico = { richText: [{ text: 'Mesomedi' }, { text: 'terráneo' }] };
    const { processedData } = await convertExcelToJson(await libro([completa({ 'Piso Bioclimático': rico })]));
    assert.equal(processedData[0]['Piso Bioclimático'], 'Mesomediterráneo');
});

test('sin filas de datos devuelve listas vacías', async () => {
    const resultado = await convertExcelToJson(await libro([]));
    assert.deepEqual(resultado, { processedData: [], emptyFields: [] });
});
