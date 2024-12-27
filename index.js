const express = require('express');
const cors = require('cors');
const compression = require('compression');
const uploadRoutes = require('./endpoints/upload.js');
const updateFile = require('./endpoints/updateFile.js');
const listFiles = require('./endpoints/listFiles.js');
const listTerms = require('./endpoints/listTerms.js');
const getData = require('./endpoints/getMergedData.js');
const deleteFile = require('./endpoints/deleteFile.js');
const deleteTerm = require('./endpoints/deleteTerm.js');
const getMergedData = require('./endpoints/getData.js');
const login = require('./endpoints/login.js');
const auth = require('./endpoints/tokenAuth.js');
const sendMail = require('./endpoints/sendMail.js');
const uploadTerm = require('./endpoints/uploadTerm.js');
const confirmUpload = require('./endpoints/confirmUpload.js');
const getImage = require('./endpoints/getImage.js');
const getFile = require('./endpoints/getFile.js');
const listImages = require('./endpoints/listImages.js');
const deleteImage = require('./endpoints/deleteImage.js');
const uploadImage = require('./endpoints/uploadImage.js');
const app = express();
const PORT = process.env.PORT || 8000;

app.use("/healthcheck", (req, res) => {
    res.status(200).send("ok");
})

app.use(cors());
app.use(express.json());
app.use(compression());

app.use(uploadImage);
app.use(deleteImage);
app.use(listImages);
app.use(getFile);
app.use(confirmUpload);
app.use(getImage);
app.use(sendMail);
app.use(deleteFile);
app.use(deleteTerm);
app.use(updateFile);
app.use(uploadRoutes);
app.use(listFiles);
app.use(listTerms);
app.use(getData);
app.use(login);
app.use(uploadTerm);
app.use(auth);
app.use(getMergedData);

app.listen(PORT, () => {
    console.log(`Servidor corriendo en ${PORT}`);
});