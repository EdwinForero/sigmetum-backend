const { S3, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { fromSSO } = require('@aws-sdk/credential-providers');
const { BACKUP_FILES, USED_FILES } = require('../config/s3Paths');

const fs = require('fs');
const path = require('path');

const isLocal = process.env.NODE_ENV === 'local';

const s3 = new S3({
    region: process.env.AWS_REGION,
    credentials: isLocal ? fromSSO({ profile: process.env.AWS_PROFILE }) : undefined,
});

exports.getPresignedUrlsFromS3Folder = async (folderPath) => {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Prefix: folderPath.endsWith('/') ? folderPath : `${folderPath}/`,
    };
  
    try {
      const command = new ListObjectsV2Command(params);
      const response = await s3.send(command);
  
      if (!response.Contents || response.Contents.length === 0) {
        throw new Error('No se encontraron archivos en la carpeta especificada.');
      }

      const urls = await Promise.all(
        response.Contents.map(async (item) => {
          const getObjectParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: item.Key,
          };
          const getObjectCommand = new GetObjectCommand(getObjectParams);
          const url = await getSignedUrl(s3, getObjectCommand, { expiresIn: 3600 });
  
          return {
            fileName: item.Key.replace(folderPath, '').replace(/^\//, ''),
            url,
          };
        })
      );
  
      return urls;
    } catch (error) {
      console.error('Error obteniendo URLs prefirmadas:', error);
      throw new Error('Error obteniendo las URLs prefirmadas para los archivos en la carpeta.');
    }
};

exports.getPresignedUrlFromS3 = async (filePath, imageKey) => {
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: `${filePath}/${imageKey}`,
    };
  
    const command = new GetObjectCommand(params);
  
    try {
      const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
      return url;
    } catch (error) {
      console.error("Error obteniendo la imagen de S3: ", error);
      throw new Error("Error obteniendo la URL firmada");
    }
};

exports.getTextJsonS3 = async (fileName, folderName) => {
    try {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${folderName}/${fileName}`,
        };

        const data = await s3.getObject(params);
        const jsonData = await streamToString(data.Body);
        return JSON.parse(jsonData);
    } catch (error) {
        return [];
    }
}

exports.deleteTermFromS3 = async (termToDelete, fileName, folderName) => {
    try {
      const terms = await exports.getTextJsonS3(fileName, folderName);
  
      const updatedTerms = terms.filter((item) => item.term !== termToDelete);
  
      const uploadParams = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `${folderName}/${fileName}`,
        Body: JSON.stringify(updatedTerms, null, 2),
        ContentType: 'application/json',
      };
  
      await s3.putObject(uploadParams);
      return { success: true };
    } catch (error) {
      console.error('Error al eliminar el término:', error);
      return { success: false, message: error.message };
    }
};

exports.uploadTextToJsonS3 = async (newText, fileName, folderName) => {
    try {

        const existingContent = await exports.getTextJsonS3(fileName, folderName);
        existingContent.push({ term: newText });

        const uploadParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${folderName}/${fileName}`,
            Body: JSON.stringify(existingContent, null, 2),
            ContentType: 'application/json',
        };

        const result = await s3.putObject(uploadParams);
        return result.Location;
    } catch (error) {
        console.error(`Error subiendo texto: ${error.message}`);
        throw error;
    }
};

exports.uploadImageToS3 = async (file, filePath, fileKey) => {
    try {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key:  `${filePath}/${fileKey}`,
            Body: file.buffer,
            ContentType: file.mimetype
        };
    
        const uploadResult = await s3.putObject(params);
        return uploadResult.Location;
    } catch (error) {
        console.error(`Error subiendo archivo: ${error.message}`);
        throw error;
    }
};

exports.uploadFileToS3 = async (fileName, bodyOrPath, folderName) => {
    try {
        const body = Buffer.isBuffer(bodyOrPath)
            ? bodyOrPath
            : fs.createReadStream(bodyOrPath);

        const uploadParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${folderName}/${fileName}`,
            Body: body,
        };

        const data = await s3.putObject(uploadParams);
        return data.Location;
    } catch (error) {
        console.error(`Error subiendo archivo: ${error.message}`);
        throw error;
    }
};

exports.listFilesInS3Folder = async (folderName) => {
    try {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Prefix: folderName,
        };

        const data = await s3.listObjectsV2(params);

        if (!data.Contents || data.Contents.length === 0) {
            return [];
        }

        return data.Contents
            .filter(file => file.Size > 0)
            .map(file => ({
                name: path.basename(file.Key),
                key: file.Key,
            }));
    } catch (error) {
        console.error("Error listing files:", error);
        throw error;
    }
};

exports.updateFileS3 = async (filePath, fileName) => {
    try {
        const jsonSourceData = await exports.getFileFromS3(filePath);
        const uploadParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${USED_FILES}/${fileName}.json`,
            Body: JSON.stringify(jsonSourceData),
        };

        const data = await s3.putObject(uploadParams);
        return data.Location;
    } catch (error) {
        console.error(`Error actualizando archivo: ${error.message}`);
        throw error;
    }
};

exports.getFileFromS3 = async (filePath) => {
    try {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: filePath,
        };

        const data = await s3.getObject(params);
        const jsonData = await streamToString(data.Body);
        return JSON.parse(jsonData);
    } catch (error) {
        console.error(`Error al obtener el archivo: ${error.message}`);
        throw error;
    }
};

exports.deleteImageFromS3 = async (filePath, imageKey) => {
    try {
        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: `${filePath}/${imageKey}`,
        };

        await s3.deleteObject(params);
        return { success: true };
    } catch (error) {
        console.error('Error al eliminar el archivo de S3:', error);
        return { success: false, error: error.message };
    }
};

exports.deleteFileFromS3 = async (filePath) => {
    try {
        const [folder, versionedFile] = filePath.split('/').slice(-2);
        const baseFileName = versionedFile.split('_')[0];
        const folderPrefix = `${BACKUP_FILES}/${folder}`;

        const deleteParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: filePath,
        };
        await s3.deleteObject(deleteParams);

        const listParams = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Prefix: folderPrefix,
        };
        const listedObjects = await s3.listObjectsV2(listParams);

        const fixedFilePath = `${USED_FILES}/${baseFileName}.json`;

        if (!listedObjects.Contents || listedObjects.Contents.length === 0) {
            const deleteFixedFileParams = {
                Bucket: process.env.AWS_BUCKET_NAME,
                Key: fixedFilePath,
            };
            await s3.deleteObject(deleteFixedFileParams);
        } else {
            const files = listedObjects.Contents.map((file) => file.Key);
            const relatedFiles = files.filter((file) =>
                file.startsWith(`${folderPrefix}/${baseFileName}_V`)
            );

            const sortedVersions = relatedFiles
                .map((file) => {
                    const match = file.match(/_V(\d+)_/);
                    return match ? { key: file, version: parseInt(match[1], 10) } : null;
                })
                .filter(Boolean)
                .sort((a, b) => b.version - a.version);

            const versionToRestore = sortedVersions[0];

            const copyParams = {
                Bucket: process.env.AWS_BUCKET_NAME,
                CopySource: `${process.env.AWS_BUCKET_NAME}/${encodeURIComponent(versionToRestore.key)}`,
                Key: fixedFilePath,
            };

            await s3.copyObject(copyParams);
        }

        return { message: 'Proceso completado exitosamente' };
    } catch (error) {
        console.error(`Error al procesar la eliminación: ${error.message}`);
        throw error;
    }
};


const streamToString = (stream) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        stream.on("error", reject);
    });
};

exports.getMergedDataInS3Folder = async (folderName) => {
    try {
        const files = await exports.listFilesInS3Folder(folderName);
        let mergedData = [];

        for (const file of files) {
            const fileName = file.key;
            const jsonData = await exports.getFileFromS3(fileName);
            
            mergedData = mergedData.concat(jsonData);
        }

        return mergedData;
    } catch (error) {
        console.error("Error merging JSON files:", error);
        throw error;
    }
};