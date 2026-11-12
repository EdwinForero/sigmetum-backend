const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { tokenAuth } = require('../middleware/tokenAuthentication');
const { validateContactMessage } = require('../functions/validateContactMessage');
const { isValidImageKey } = require('../functions/validateImageKey');
const { validateImageUpload } = require('../functions/validateImageUpload');
const {
    getPresignedUrlsFromS3Folder,
    getPresignedUrlFromS3,
    uploadImageToS3,
    deleteImageFromS3,
    getTextJsonS3,
    uploadTextToJsonS3,
    deleteTermFromS3,
    putJsonToS3,
} = require('../aws/awsS3connect');
const {
    sanitizeRecipients,
    planAddRecipient,
    planRemoveRecipient,
    buildRecipientChangeNotice,
    recipientsForContact,
    LIST_UNAVAILABLE_SUBJECT_PREFIX,
} = require('../functions/contactRecipients');
const { GALLERY_PATH, TERMS_PATH, TERMS_FILE, CONTACT_PATH, CONTACT_RECIPIENTS_FILE } = require('../config/s3Paths');

// Maximum accepted file size. multer rejects a size equal to fileSize, so 1 is added to accept exactly the maximum.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES + 1 } });

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
    },
});

const sendEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    message: { success: false, error: 'Too many messages. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Una sola instancia para el alta y la baja de destinatarios: 10 cambios cada 15 minutos por IP. Va como segundo manejador de
// cada ruta (tokenAuth primero), nunca con router.use.
const recipientsLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { success: false, error: 'Too many changes. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Lee la lista de destinatarios. Sin pasar vacioSiAccessDenied: la lista es privada y un permiso roto no debe verse como lista vacía.
const readRecipients = async () => sanitizeRecipients(await getTextJsonS3(CONTACT_RECIPIENTS_FILE, CONTACT_PATH));

// Tiempo máximo que /send-email espera a la lista: el cliente S3 no tiene requestTimeout y, si S3 se cuelga, la lectura no
// rechaza nunca. Al vencer se trata como un fallo de lectura (respaldo a EMAIL con el asunto marcado). El temporizador se limpia.
const RECIPIENTS_READ_TIMEOUT_MS = 4000;
const readRecipientsWithTimeout = () => {
    let timer;
    const expired = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('recipient list read timed out'), { name: 'TimeoutError' })), RECIPIENTS_READ_TIMEOUT_MS);
    });
    return Promise.race([readRecipients(), expired]).finally(() => clearTimeout(timer));
};

// Aviso del cambio a los destinatarios de la lista ANTERIOR (o a EMAIL si estaba vacía): un envío por destinatario, para que
// nadie vea la lista ajena. La llaman sin await y con .catch: un fallo no cambia la respuesta y solo deja un registro fijo
// (sin err.message ni direcciones, S8). Es async para que un throw síncrono de buildRecipientChangeNotice sea un rechazo capturado.
const NOTICE_FAILED = '[recipients] change notice not sent';
const notifyRecipientChange = async (previous, action, email) => {
    const to = recipientsForContact(previous, process.env.EMAIL); // mismo filtro que /send-email; sin válidas, EMAIL
    const { subject, text } = buildRecipientChangeNotice({ action, email, date: new Date() });
    const results = await Promise.allSettled(
        to.map((address) => Promise.resolve().then(() => transporter.sendMail({ from: process.env.EMAIL, to: address, subject, text })))
    );
    if (results.some((result) => result.status === 'rejected')) console.error(NOTICE_FAILED);
};

// ─── Public routes ───────────────────────────────────────────────────────────

router.post('/send-email', sendEmailLimiter, async (req, res, next) => {
    try {
        const { error, value } = validateContactMessage(req.body);
        if (error) {
            return res.status(400).json({ success: false, error });
        }
        const { username, email, subject, message } = value;

        // Destinatarios: la lista de data/contact/recipients.json o, si no hay ninguna válida, EMAIL. Si la lectura falla (también
        // AccessDenied, que por S15 es «falta el fichero»), el mensaje va a EMAIL con el asunto marcado y un registro fijo (S8).
        let recipients;
        let subjectPrefix = '';
        try {
            recipients = recipientsForContact(await readRecipientsWithTimeout(), process.env.EMAIL);
        } catch (listError) {
            console.error('[send-email] recipient list unavailable, using EMAIL:', listError?.name);
            recipients = [process.env.EMAIL];
            subjectPrefix = LIST_UNAVAILABLE_SUBJECT_PREFIX;
        }

        const mailOptions = {
            from: process.env.EMAIL,
            to: recipients,
            replyTo: email,
            subject: `${subjectPrefix}${subject} - enviado por ${username}<${email}>`,
            text: message,
        };
        await transporter.sendMail(mailOptions);
        res.status(200).json({ success: true, data: 'Email sent successfully.' });
    } catch (error) {
        next(error);
    }
});

router.get('/list-images', async (req, res, next) => {
    try {
        const urls = await getPresignedUrlsFromS3Folder(GALLERY_PATH);
        res.json({ success: true, data: urls });
    } catch (error) {
        next(error);
    }
});

router.get('/get-image', async (req, res, next) => {
    try {
        const { imageKey } = req.query;
        if (typeof imageKey !== 'string' || !imageKey) {
            return res.status(400).json({ success: false, error: 'imageKey is required' });
        }

        if (!isValidImageKey(imageKey)) {
            return res.status(400).json({ success: false, error: 'imageKey is not valid' });
        }

        const imageUrl = await getPresignedUrlFromS3(GALLERY_PATH, imageKey);
        res.json({ success: true, data: { imageUrl } });
    } catch (error) {
        next(error);
    }
});

router.get('/list-terms', async (req, res, next) => {
    try {
        // Lectura pública: AccessDenied equivale a glosario vacío (S15). Las rutas que escriben no pasan esta opción.
        const terms = await getTextJsonS3(TERMS_FILE, TERMS_PATH, { vacioSiAccessDenied: true });
        res.json({ success: true, data: terms });
    } catch (error) {
        next(error);
    }
});

// ─── Protected routes ────────────────────────────────────────────────────────

router.post('/upload-image', tokenAuth, upload.single('file'), async (req, res, next) => {
    try {
        const file = req.file;
        const title = req.body.title;

        if (!file || typeof title !== 'string' || !title) {
            return res.status(400).json({ success: false, error: 'File and title are required' });
        }

        const { error, value } = validateImageUpload({ file, title });
        if (error) {
            return res.status(400).json({ success: false, error });
        }

        await uploadImageToS3({ buffer: file.buffer, mimetype: value.contentType }, GALLERY_PATH, value.key);
        res.status(200).json({ success: true, data: { key: `${GALLERY_PATH}/${value.key}` } });
    } catch (error) {
        next(error);
    }
});

router.delete('/delete-image', tokenAuth, async (req, res, next) => {
    const { imageKey } = req.body;

    if (typeof imageKey !== 'string' || !imageKey) {
        return res.status(400).json({ success: false, error: 'imageKey is required' });
    }
    if (!isValidImageKey(imageKey)) {
        return res.status(400).json({ success: false, error: 'imageKey is not valid' });
    }

    try {
        await deleteImageFromS3(GALLERY_PATH, imageKey);
        res.status(200).json({ success: true, data: 'Image deleted successfully' });
    } catch (error) {
        next(error);
    }
});

router.post('/upload-term', tokenAuth, async (req, res, next) => {
    try {
        const { term } = req.body;
        if (typeof term !== 'string') {
            return res.status(400).json({ success: false, error: 'Term must be a string' });
        }
        if (!term.trim()) {
            return res.status(400).json({ success: false, error: 'Term cannot be empty' });
        }

        await uploadTextToJsonS3(term, TERMS_FILE, TERMS_PATH);
        res.status(200).json({ success: true, data: 'Term added successfully' });
    } catch (error) {
        next(error);
    }
});

router.delete('/delete-term', tokenAuth, async (req, res, next) => {
    const { term } = req.body;

    if (typeof term !== 'string' || !term) {
        return res.status(400).json({ success: false, error: 'Term is required' });
    }

    try {
        await deleteTermFromS3(term, TERMS_FILE, TERMS_PATH);
        res.json({ success: true, data: 'Term deleted successfully' });
    } catch (error) {
        next(error);
    }
});

router.get('/list-recipients', tokenAuth, async (req, res, next) => {
    try {
        res.json({ success: true, data: await readRecipients() });
    } catch (error) {
        next(error);
    }
});

router.post('/add-recipient', tokenAuth, recipientsLimiter, async (req, res, next) => {
    try {
        const previous = await readRecipients();
        const plan = planAddRecipient(previous, req.body.email);
        if (plan.error) {
            return res.status(plan.status).json({ success: false, error: plan.error });
        }

        await putJsonToS3(`${CONTACT_PATH}/${CONTACT_RECIPIENTS_FILE}`, plan.next);
        res.status(200).json({ success: true, data: 'Recipient added successfully' });
        notifyRecipientChange(previous, 'add', plan.email).catch(() => console.error(NOTICE_FAILED));
    } catch (error) {
        next(error);
    }
});

router.delete('/delete-recipient', tokenAuth, recipientsLimiter, async (req, res, next) => {
    try {
        const previous = await readRecipients();
        const plan = planRemoveRecipient(previous, req.body.email);
        if (plan.error) {
            return res.status(plan.status).json({ success: false, error: plan.error });
        }

        await putJsonToS3(`${CONTACT_PATH}/${CONTACT_RECIPIENTS_FILE}`, plan.next);
        res.status(200).json({ success: true, data: 'Recipient deleted successfully' });
        notifyRecipientChange(previous, 'remove', plan.removed).catch(() => console.error(NOTICE_FAILED));
    } catch (error) {
        next(error);
    }
});

module.exports = router;
