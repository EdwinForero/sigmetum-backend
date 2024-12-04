function formatFileName(provincia, extension, version = 1) {
    const date = new Date();
    const formattedDate = `${date.getDate().toString().padStart(2, '0')}_${(date.getMonth() + 1).toString().padStart(2, '0')}_${date.getFullYear()}`;

    return `${provincia}_V${version}_${formattedDate}${extension}`;
}

module.exports = { formatFileName };