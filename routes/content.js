const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const router = express.Router();

const { tokenAuth } = require('../functions/tokenAuthentication');
const {
    getPresignedUrlsFromS3Folder,
    getPresignedUrlFromS3,
    uploadImageToS3,
    deleteImageFromS3,
    getTextJsonS3,
    uploadTextToJsonS3,
    deleteTermFromS3,
} = require('../aws/awsS3connect');
const {
    GALLERY_PATH,
    IMAGES_PATH,
    FILES_PATH,
    CONTENT_PATH,
    TERMS_FILE,
} = require('../config/s3Paths');

const storage = multer.memoryStorage();
const upload = multer({ storage });

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_PASSWORD,
    },
});

// --- Rutas públicas ---

router.post('/send-email', async (req, res, next) => {
    const { username, email, subject, message } = req.body;
    const mailOptions = {
        from: process.env.EMAIL,
        to: process.env.EMAIL,
        replyTo: email,
        subject: `${subject} - enviado por ${username}<${email}>`,
        text: message,
    };
    try {
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
        const imageUrl = await getPresignedUrlFromS3(IMAGES_PATH, req.query.imageKey);
        res.json({ success: true, data: { imageUrl } });
    } catch (error) {
        next(error);
    }
});

router.get('/get-file', async (req, res, next) => {
    try {
        const fileUrl = await getPresignedUrlFromS3(FILES_PATH, req.query.fileKey);
        res.json({ success: true, data: { fileUrl } });
    } catch (error) {
        next(error);
    }
});

router.get('/list-terms', async (req, res, next) => {
    try {
        const terms = await getTextJsonS3(TERMS_FILE, CONTENT_PATH);
        res.json({ success: true, data: terms });
    } catch (error) {
        next(error);
    }
});

// --- Rutas protegidas ---

const protectedRouter = express.Router();
protectedRouter.use(tokenAuth);

protectedRouter.post('/upload-image', upload.single('file'), async (req, res, next) => {
    try {
        const file = req.file;
        const title = req.body.title;

        if (!file || !title) {
            return res.status(400).json({ success: false, error: 'File and title are required' });
        }

        const sanitizedTitle = title.replace(/\s+/g, '_');
        const fileExtension = file.originalname.substring(file.originalname.lastIndexOf('.'));
        const fileKey = `${sanitizedTitle}${fileExtension}`;

        const result = await uploadImageToS3(file, GALLERY_PATH, fileKey);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        next(error);
    }
});

protectedRouter.delete('/delete-image', async (req, res, next) => {
    const { imageKey } = req.body;

    if (!imageKey) {
        return res.status(400).json({ success: false, error: 'imageKey is required' });
    }

    try {
        const result = await deleteImageFromS3(GALLERY_PATH, imageKey);
        if (result.success) {
            res.status(200).json({ success: true, data: 'Image deleted successfully' });
        } else {
            res.status(500).json({ success: false, error: result.error });
        }
    } catch (error) {
        next(error);
    }
});

protectedRouter.post('/upload-term', async (req, res, next) => {
    try {
        const { term } = req.body;
        if (!term || !term.trim()) {
            return res.status(400).json({ success: false, error: 'Term cannot be empty' });
        }

        const fileUrl = await uploadTextToJsonS3(term, TERMS_FILE, CONTENT_PATH);
        res.status(200).json({ success: true, data: { message: 'Term added successfully', fileUrl } });
    } catch (error) {
        next(error);
    }
});

protectedRouter.delete('/delete-term', async (req, res, next) => {
    const { term } = req.body;

    if (!term) {
        return res.status(400).json({ success: false, error: 'Term is required' });
    }

    try {
        const result = await deleteTermFromS3(term, TERMS_FILE, CONTENT_PATH);
        if (result.success) {
            res.json({ success: true, data: 'Term deleted successfully' });
        } else {
            res.status(500).json({ success: false, error: result.message });
        }
    } catch (error) {
        next(error);
    }
});

router.use(protectedRouter);

module.exports = router;
