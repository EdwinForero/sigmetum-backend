// Buffers mínimos con la firma real de cada formato de imagen (no son imágenes decodificables completas).
const FIRMAS = {
    jpg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    gif87: Buffer.from('GIF87a', 'latin1'),
    gif89: Buffer.from('GIF89a', 'latin1'),
    // RIFF + 4 bytes de tamaño + WEBP
    webp: Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x04, 0x00, 0x00, 0x00]), Buffer.from('WEBP', 'latin1')]),
};

const imagenes = {
    jpg: FIRMAS.jpg,
    png: FIRMAS.png,
    gif87: FIRMAS.gif87,
    gif89: FIRMAS.gif89,
    webp: FIRMAS.webp,
};

// Buffer de `bytes` bytes que empieza por la firma del tipo y se rellena con "a".
const conFirma = (tipo, bytes) => {
    const firma = FIRMAS[tipo];
    if (!firma) throw new Error(`tipo desconocido: ${tipo}`);
    return Buffer.concat([firma, Buffer.alloc(Math.max(0, bytes - firma.length), 'a')]);
};

module.exports = { imagenes, conFirma };
