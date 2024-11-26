const XLSX = require('xlsx');

const convertExcelToJson = (filePath) => {
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const columnMapping = [
        "province",
        "municipe",
        "averageAltitude",
        "biogeographicSector",
        "bioclimaticFloor",
        "ombrotype",
        "natureOfSubstrate",
        "seriesType",
        "vegetationSeries",
        "potentialVegetation",
        "characteristicSpecies"
    ];

    const processedData = jsonData.slice(1).map(row => {
        const processedRow = {};
        row.forEach((cellValue, index) => {
            const formattedKey = columnMapping[index];
            if (formattedKey && cellValue !== null && cellValue !== '') {
                if (typeof cellValue === 'string' && cellValue.includes(',')) {
                    processedRow[formattedKey] = cellValue
                        .split(',')
                        .map(item => item.trim())
                        .filter(item => item !== '');
                } else {
                    processedRow[formattedKey] = cellValue;
                }
            }
        });
        return processedRow;
    });

    return processedData;
};

module.exports = { convertExcelToJson };