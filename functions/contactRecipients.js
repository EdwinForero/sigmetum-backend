// Lista de destinatarios del formulario de contacto: reglas puras (sin S3, sin SMTP, sin entorno).
// Los mensajes de error son fijos y no reflejan el correo recibido (S8).
const { isValidEmailAddress } = require('./validateContactMessage');

const RECIPIENTS_MIN = 1;
const RECIPIENTS_MAX = 5;
const EMAIL_MAX = 254;

const normalizeEmail = (s) => s.trim().toLowerCase();

// Dedupe por normalizeEmail: conserva la primera aparición (orden y formato).
const uniqueByEmail = (emails) => {
    const seen = new Set();
    return emails.filter((email) => {
        const key = normalizeEmail(email);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

// Del fichero solo se conservan los { email } cuyo email es una cadena y una dirección válida (una con espacios alrededor
// no lo es), sin repetir direcciones (primera aparición). Solo cuentan para el mínimo y el máximo las que quedan.
const sanitizeRecipients = (list) => (Array.isArray(list)
    ? uniqueByEmail(list.filter((item) => item && typeof item.email === 'string' && isValidEmailAddress(item.email)).map((item) => item.email))
        .map((email) => ({ email }))
    : []);

const rejection = (status, error) => ({ status, error });

// Alta: devuelve { status: 400, error } o { next, email }. La lista no se muta.
const planAddRecipient = (list, raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return rejection(400, 'email is required');
    const email = raw.trim();
    if (!isValidEmailAddress(email)) return rejection(400, 'email is not valid');
    if (list.some((item) => normalizeEmail(item.email) === normalizeEmail(email))) return rejection(400, 'Recipient already exists');
    if (list.length >= RECIPIENTS_MAX) return rejection(400, 'Recipient limit reached');
    return { next: [...list, { email }], email };
};

// Baja: devuelve { status, error } o { next, removed }. La lista no se muta.
const planRemoveRecipient = (list, raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return rejection(400, 'email is required');
    if (raw.trim().length > EMAIL_MAX) return rejection(400, 'email is not valid');
    const wanted = normalizeEmail(raw);
    const found = list.find((item) => normalizeEmail(item.email) === wanted);
    if (!found) return rejection(404, 'Recipient not found');
    if (list.length <= RECIPIENTS_MIN) return rejection(400, 'At least one recipient is required');
    return { next: list.filter((item) => item !== found), removed: found.email };
};

// Dirección enmascarada para el aviso: primer carácter + ***@ + dominio (sin @, ***). Nunca lleva la parte local entera.
// Cada carácter \p{Cf} se sustituye por un ? visible: el aviso no reproduce caracteres invisibles ni de inversión de texto.
const maskEmail = (raw) => {
    const email = raw.replace(/\p{Cf}/gu, '?');
    const at = email.indexOf('@');
    if (at < 1) return '***';
    return `${[...email][0]}***@${email.slice(at + 1)}`;
};

// Aviso de cambio en la lista (texto fijo en español): tipo de cambio, dirección enmascarada y fecha UTC. Nunca la lista
// completa, ni quién hizo el cambio, ni datos de los mensajes de contacto.
const buildRecipientChangeNotice = ({ action, email, date }) => {
    const iso = date.toISOString();
    const when = `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
    const added = action === 'add';
    return {
        subject: `${added ? 'Alta' : 'Baja'} de un destinatario del formulario de contacto de SIGMETUM-A`,
        text: [
            `Se ha ${added ? 'añadido' : 'quitado'} la dirección ${maskEmail(email)} en la lista de destinatarios de los mensajes del formulario de contacto.`,
            `Fecha: ${when}.`,
            'Si no reconoces este cambio, avisa al administrador del sitio.',
        ].join('\n'),
    };
};

// Marca del asunto de /send-email cuando no se pudo leer la lista y el mensaje va al respaldo (EMAIL).
const LIST_UNAVAILABLE_SUBJECT_PREFIX = '[Aviso: lista de destinatarios no disponible] ';

// Destinatarios de /send-email: los correos válidos de la lista (las entradas no válidas del fichero se descartan), sin
// repetir direcciones, o, si no queda ninguno, [fallback].
const recipientsForContact = (list, fallback) => {
    const valid = uniqueByEmail(list.map((item) => item.email).filter(isValidEmailAddress));
    return valid.length ? valid : [fallback];
};

module.exports = {
    RECIPIENTS_MIN, RECIPIENTS_MAX, LIST_UNAVAILABLE_SUBJECT_PREFIX,
    normalizeEmail, sanitizeRecipients, planAddRecipient, planRemoveRecipient,
    maskEmail, buildRecipientChangeNotice, recipientsForContact,
};
