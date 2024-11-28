const express = require('express');
const nodemailer = require("nodemailer");
const router = express.Router();

router.post("/send-email", async (req, res) => {
    const { username, email, subject, message } = req.body;
  
    const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: {
          user: process.env.EMAIL,
          pass: process.env.EMAIL_PASSWORD,
        },
      });
  
    const mailOptions = {
      from: process.env.EMAIL,
      to: process.env.EMAIL,
      replyTo: email,
      subject: `${subject} - enviado por ${username}<${email}>`,
      text: message,
    };
  
    try {
      await transporter.sendMail(mailOptions);
      res.status(200).send("Correo enviado correctamente.");
    } catch (error) {
      console.error("Error al enviar correo:", error);
      res.status(500).send("Error al enviar correo.");
    }
  });

  module.exports = router;