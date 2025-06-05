require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const FormData = require("form-data");
const { PDFDocument } = require("pdf-lib");

const app = express();
app.use(bodyParser.json());

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;

  console.log("Full message received:", JSON.stringify(message, null, 2));

  // If it's a PDF document
  if (message.document && message.document.mime_type === "application/pdf") {
    const fileId = message.document.file_id;

    try {
      const fileResp = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
      const filePath = fileResp.data.result.file_path;

      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
      const pdfBuffer = (await axios.get(fileUrl, { responseType: "arraybuffer" })).data;

      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const compressedPdf = await pdfDoc.save({ useObjectStreams: true });

      const outputPath = path.join(__dirname, "compressed.pdf");
      fs.writeFileSync(outputPath, compressedPdf);

      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("document", fs.createReadStream(outputPath));

      await axios.post(`${TELEGRAM_API}/sendDocument`, form, {
        headers: form.getHeaders(),
      });

      fs.unlinkSync(outputPath); // cleanup
    } catch (err) {
      console.error("Error compressing PDF:", err.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ Error while processing PDF.",
      });
    }

    return res.sendStatus(200);
  }

  // If it's text
  if (message.text) {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📄 Please send a PDF file to compress.`,
    });
    return res.sendStatus(200);
  }

  // Other file types or unsupported content
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `⚠️ I only work with PDF files. Please send a PDF.`,
  });

  return res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Bot is live!");
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
