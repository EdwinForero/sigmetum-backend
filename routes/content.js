const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const { tokenAuth } = require('../functions/tokenAuthentication');
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
} = require('../aws/awsS3connect');
const { GALLERY_PATH, TERMS_PATH, TERMS_FILE } = require('../config/s3Paths');

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

// ─── Public routes ───────────────────────────────────────────────────────────

router.post('/send-email', sendEmailLimiter, async (req, res, next) => {
    try {
        const { error, value } = validateContactMessage(req.body);
        if (error) {
            return res.status(400).json({ success: false, error });
        }
        const { username, email, subject, message } = value;

        const mailOptions = {
            from: process.env.EMAIL,
            to: process.env.EMAIL,
            replyTo: email,
            subject: `${subject} - enviado por ${username}<${email}>`,
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
        const terms = await getTextJsonS3(TERMS_FILE, TERMS_PATH);
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
        const result = await deleteImageFromS3(GALLERY_PATH, imageKey);
        if (result.success) {
            res.status(200).json({ success: true, data: 'Image deleted successfully' });
        } else {
            next(new Error(result.error || 'delete-image failed'));
        }
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
        const result = await deleteTermFromS3(term, TERMS_FILE, TERMS_PATH);
        if (result.success) {
            res.json({ success: true, data: 'Term deleted successfully' });
        } else {
            next(new Error(result.message || 'delete-term failed'));
        }
    } catch (error) {
        next(error);
    }
});

module.exports = router;
