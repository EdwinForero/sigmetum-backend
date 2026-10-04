const { S3, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { fromSSO } = require('@aws-sdk/credential-providers');
const { convertExcelToJson } = require('../functions/convertExcelToJson');
const { ACTIVE_PATH, DATA_PATH } = require('../config/s3Paths');

const path = require('path');

const isLocal = process.env.NODE_ENV === 'local';

const s3 = new S3({
    region: process.env.AWS_REGION,
    credentials: isLocal ? fromSSO({ profile: process.env.AWS_PROFILE }) : undefined,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const streamToString = (stream) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        stream.on('error', reject);
    });

const streamToBuffer = (stream) =>
    new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });

// ─── Presigned URLs ──────────────────────────────────────────────────────────

exports.getPresignedUrlsFromS3Folder = async (folderPath) => {
    const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Prefix: folderPath.endsWith('/') ? folderPath : `${folderPath}/`,
    };

    try {
        const command = new ListObjectsV2Command(params);
        const response = await s3.send(command);

        if (!response.Contents || response.Contents.length === 0) {
            throw new Error('No files found in the specified folder.');
        }

        return Promise.all(
            response.Contents.map(async (item) => {
                const getObjectCommand = new GetObjectCommand({
                    Bucket: process.env.AWS_BUCKET_NAME,
                    Key: item.Key,
                });
                const url = await getSignedUrl(s3, getObjectCommand, { expiresIn: 3600 });
                return {
                    fileName: item.Key.replace(folderPath, '').replace(/^\//, ''),
                    url,
                };
            })
        );
    } catch (error) {
        console.error('Error getting presigned URLs:', error);
        throw error;
    }
};

exports.getPresignedUrlFromS3 = async (filePath, imageKey) => {
    const command = new GetObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `${filePath}/${imageKey}`,
    });

    try {
        return await getSignedUrl(s3, command, { expiresIn: 3600 });
    } catch (error) {
        console.error('Error getting presigned URL:', error);
        throw new Error('Error getting signed URL');
    }
};

// ─── Read ────────────────────────────────────────────────────────────────────

exports.getFileFromS3 = async (filePath) => {
    try {
        const data = await s3.getObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: filePath,
        });
        return JSON.parse(await streamToString(data.Body));
    } catch (error) {
        console.error(`Error getting file: ${error.message}`);
        throw error;
    }
};

exports.getBufferFromS3 = async (filePath) => {
    try {
        const data = await s3.getObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: filePath,
        });
        return streamToBuffer(data.Body);
    } catch (error) {
        console.error(`Error getting buffer: ${error.message}`);
        throw error;
    }
};

exports.getTextJsonS3 = async (fileName, folderName) => {
    try {
        const data = await s3.getObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${folderName}/${fileName}`,
        });
        return JSON.parse(await streamToString(data.Body));
    } catch (error) {
        return [];
    }
};

// ─── List ────────────────────────────────────────────────────────────────────

exports.listFilesInS3Folder = async (folderName) => {
    try {
        const data = await s3.listObjectsV2({
            Bucket: process.env.AWS_BUCKET_NAME,
            Prefix: folderName,
        });

        if (!data.Contents || data.Contents.length === 0) return [];

        return data.Contents
            .filter(file => file.Size > 0)
            .map(file => ({
                name: path.basename(file.Key),
                key: file.Key,
            }));
    } catch (error) {
        console.error('Error listing files:', error);
        throw error;
    }
};

exports.getMergedDataInS3Folder = async (folderName) => {
    try {
        const files = await exports.listFilesInS3Folder(folderName);
        let mergedData = [];
        for (const file of files) {
            const jsonData = await exports.getFileFromS3(file.key);
            mergedData = mergedData.concat(jsonData);
        }
        return mergedData;
    } catch (error) {
        console.error('Error merging JSON files:', error);
        throw error;
    }
};

// ─── Upload ──────────────────────────────────────────────────────────────────

exports.uploadFileToS3 = async (fileName, body, folderName) => {
    try {
        await s3.putObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${folderName}/${fileName}`,
            Body: body,
        });
    } catch (error) {
        console.error(`Error uploading file: ${error.message}`);
        throw error;
    }
};

exports.uploadImageToS3 = async (file, filePath, fileKey) => {
    try {
        await s3.putObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${filePath}/${fileKey}`,
            Body: file.buffer,
            ContentType: file.mimetype,
        });
    } catch (error) {
        console.error(`Error uploading image: ${error.message}`);
        throw error;
    }
};

exports.uploadTextToJsonS3 = async (newText, fileName, folderName) => {
    try {
        const existingContent = await exports.getTextJsonS3(fileName, folderName);
        existingContent.push({ term: newText });

        await s3.putObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${folderName}/${fileName}`,
            Body: JSON.stringify(existingContent, null, 2),
            ContentType: 'application/json',
        });
    } catch (error) {
        console.error(`Error uploading text: ${error.message}`);
        throw error;
    }
};

// ─── Delete ──────────────────────────────────────────────────────────────────

exports.deleteImageFromS3 = async (filePath, imageKey) => {
    try {
        await s3.deleteObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${filePath}/${imageKey}`,
        });
        return { success: true };
    } catch (error) {
        console.error('Error deleting image:', error);
        return { success: false, error: error.message };
    }
};

exports.deleteTermFromS3 = async (termToDelete, fileName, folderName) => {
    try {
        const terms = await exports.getTextJsonS3(fileName, folderName);
        const updatedTerms = terms.filter(item => item.term !== termToDelete);

        await s3.putObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${folderName}/${fileName}`,
            Body: JSON.stringify(updatedTerms, null, 2),
            ContentType: 'application/json',
        });
        return { success: true };
    } catch (error) {
        console.error('Error deleting term:', error);
        return { success: false, message: error.message };
    }
};

exports.deleteFileFromS3 = async (filePath) => {
    try {
        // filePath: data/{provincia}/{date}_v{n}.xlsx
        const parts = filePath.split('/');
        const provincia = parts[1];
        const provinciaFolder = `${DATA_PATH}/${provincia}`;
        const activeKey = `${ACTIVE_PATH}/${provincia}.json`;

        await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: filePath });

        const remaining = await exports.listFilesInS3Folder(provinciaFolder);
        const xlsxFiles = remaining
            .filter(f => f.name.endsWith('.xlsx'))
            .sort((a, b) => a.name.localeCompare(b.name));

        if (xlsxFiles.length === 0) {
            await s3.deleteObject({ Bucket: process.env.AWS_BUCKET_NAME, Key: activeKey });
        } else {
            const latestKey = xlsxFiles[xlsxFiles.length - 1].key;
            const buffer = await exports.getBufferFromS3(latestKey);
            const { processedData } = await convertExcelToJson(buffer);
            await s3.putObject({
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: activeKey,
                Body: JSON.stringify(processedData, null, 2),
                ContentType: 'application/json',
            });
        }

        return { message: 'File deleted successfully' };
    } catch (error) {
        console.error(`Error deleting file: ${error.message}`);
        throw error;
    }
};

// ─── Select active version ───────────────────────────────────────────────────

exports.updateFileS3 = async (filePath) => {
    try {
        // filePath: data/{provincia}/{date}_v{n}.xlsx
        const provincia = filePath.split('/')[1];
        const buffer = await exports.getBufferFromS3(filePath);
        const { processedData } = await convertExcelToJson(buffer);

        await s3.putObject({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${ACTIVE_PATH}/${provincia}.json`,
            Body: JSON.stringify(processedData, null, 2),
            ContentType: 'application/json',
        });
    } catch (error) {
        console.error(`Error setting active version: ${error.message}`);
        throw error;
    }
};
