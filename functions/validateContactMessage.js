// Validación del cuerpo de POST /send-email. Función pura: no lee el entorno ni habla con SMTP.
// Los mensajes de error son fijos y no reflejan el valor recibido.
const USERNAME_MAX = 100;
const SUBJECT_MAX = 150;
const MESSAGE_MAX = 2000;
const EMAIL_MAX = 254;

// Formato básico: sin espacios, comas, punto y coma, dos puntos, ángulos, paréntesis, comillas ni barra
// invertida, y con un punto en el dominio.
const EMAIL_PATTERN = /^[^\s@,;:<>()'"\\]+@[^\s@,;:<>()'"\\]+\.[^\s@,;:<>()'"\\]+$/;
// Campos de cabecera: ningún carácter de control (incluye \r, \n, NUL y U+0085) ni U+2028/U+2029.
const HEADER_FORBIDDEN = /[\p{Cc}\u2028\u2029]/u;
// Mensaje: admite \n, \r y \t; rechaza el resto de controles.
const MESSAGE_FORBIDDEN = /(?![\n\r\t])\p{Cc}/u;

const validateContactMessage = (body) => {
    const { username, email, subject, message } = body || {};
    const fields = [username, email, subject, message];
    if (fields.some(f => typeof f !== 'string' || !f.trim())) {
        return { error: 'username, email, subject and message are required and must be strings' };
    }

    const value = {
        username: username.trim(),
        email: email.trim(),
        subject: subject.trim(),
        message: message.trim(),
    };

    if (value.username.length > USERNAME_MAX) {
        return { error: `username must be at most ${USERNAME_MAX} characters` };
    }
    if (value.subject.length > SUBJECT_MAX) {
        return { error: `subject must be at most ${SUBJECT_MAX} characters` };
    }
    if (value.message.length > MESSAGE_MAX) {
        return { error: `message must be at most ${MESSAGE_MAX} characters` };
    }
    if (value.email.length > EMAIL_MAX) {
        return { error: `email must be at most ${EMAIL_MAX} characters` };
    }
    if (HEADER_FORBIDDEN.test(value.username) || HEADER_FORBIDDEN.test(value.email) || HEADER_FORBIDDEN.test(value.subject)) {
        return { error: 'username, email and subject must not contain control characters or line breaks' };
    }
    if (MESSAGE_FORBIDDEN.test(value.message)) {
        return { error: 'message must not contain control characters' };
    }
    if (!EMAIL_PATTERN.test(value.email)) {
        return { error: 'email is not valid' };
    }

    return { value };
};

module.exports = { validateContactMessage };
