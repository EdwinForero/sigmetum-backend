const XLSX = require('xlsx');

const convertExcelToJson = (filePath) => {
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    const columnMapping = [
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

    const processedData = jsonData.map(row => {
        const processedRow = {};
        Object.values(row).forEach((value, index) => {
            const formattedKey = columnMapping[index];
            if (formattedKey && value !== null && value !== '') {
                if (typeof value === 'string' && value.includes(',')) {
                    processedRow[formattedKey] = value.split(',').map(item => item.trim()).filter(item => item !== '');
                } else {
                    processedRow[formattedKey] = value;
                }
            }
        });
        return processedRow;
    });

    return processedData;
};

module.exports = { convertExcelToJson };