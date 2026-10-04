const ExcelJS = require('exceljs');

const fixedColumnOrder = [
    'Provincia',
    'Municipio',
    'Altitud Media',
    'Sector Biogeográfico',
    'Piso Bioclimático',
    'Ombrotipo',
    'Naturaleza del Sustrato',
    'Tipo de Serie',
    'Serie de Vegetación',
    'Vegetación Potencial',
    'Especies Características',
];

const getCellValue = (cell) => {
    const v = cell.value;
    if (v === null || v === undefined) return null;
    if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text).join('');
    if (typeof v === 'object' && v.result !== undefined) return v.result;
    return v;
};

const convertExcelToJson = async (input) => {
    const workbook = new ExcelJS.Workbook();

    if (Buffer.isBuffer(input)) {
        await workbook.xlsx.load(input);
    } else {
        await workbook.xlsx.readFile(input);
    }

    const worksheet = workbook.worksheets[0];
    const emptyFields = [];
    const processedData = [];

    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const processedRow = {};
        let hasEmptyFields = false;

        fixedColumnOrder.forEach((columnName, index) => {
            const value = getCellValue(row.getCell(index + 1));

            if (value !== null && value !== undefined && String(value).trim() !== '') {
                const strValue = String(value);
                if (strValue.includes(',')) {
                    processedRow[columnName] = strValue
                        .split(',')
                        .map(item => item.trim())
                        .filter(item => item !== '');
                } else {
                    processedRow[columnName] = value;
                }
            } else {
                hasEmptyFields = true;
            }
        });

        if (hasEmptyFields) {
            emptyFields.push({ rowIndex: rowNumber, rowData: row.values.slice(1) });
        }

        processedData.push(processedRow);
    });

    return { processedData, emptyFields };
};

module.exports = { convertExcelToJson };
