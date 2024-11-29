const XLSX = require('xlsx');

const convertExcelToJson = (filePath) => {
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const fixedColumnOrder = [
        "Provincia",
        "Municipio",
        "Altitud Media",
        "Sector Biogeográfico",
        "Piso Bioclimático",
        "Ombrotipo",
        "Naturaleza del Sustrato",
        "Tipo de Serie",
        "Serie de Vegetación",
        "Vegetación Potencial",
        "Especies Características"
    ];

    const dataRows = jsonData.slice(1);

    const processedData = dataRows.map((row) => {
        const processedRow = {};

        fixedColumnOrder.forEach((columnName, index) => {
            const value = row[index];
            if (value !== undefined && String(value).trim() !== '') {
                if (typeof value === 'string' && value.includes(',')) {
                    processedRow[columnName] = value.split(',').map(item => item.trim()).filter(item => item !== '');
                } else {
                    processedRow[columnName] = value;
                }
            }
        });

        return processedRow;
    });

    return processedData;
};

module.exports = { convertExcelToJson };