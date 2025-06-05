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

  if (!message || !message.chat) return res.sendStatus(200);

  const chatId = message.chat.id;

  // ✅ If it's a PDF document
  if (message.document && message.document.mime_type === "application/pdf") {
    const fileId = message.document.file_id;

    try {
      // Get file path
      const fileResp = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
      const filePath = fileResp.data.result.file_path;

      // Download the PDF
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
      const pdfBuffer = (await axios.get(fileUrl, { responseType: "arraybuffer" })).data;

      // Compress with pdf-lib
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      pdfDoc.setTitle(""); // Remove metadata
      const compressedPdf = await pdfDoc.save({ useObjectStreams: true });

      // Save temporarily
      const outputPath = path.join(__dirname, "compressed.pdf");
      fs.writeFileSync(outputPath, compressedPdf);

      // Send back compressed PDF
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("document", fs.createReadStream(outputPath));

      await axios.post(`${TELEGRAM_API}/sendDocument`, form, {
        headers: form.getHeaders(),
      });

      fs.unlinkSync(outputPath); // Cleanup
    } catch (err) {
      console.error("Compression error:", err.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ Failed to compress PDF.",
      });
    }

    return res.sendStatus(200);
  }

  // ✅ If it's a text message
  if (message.text) {
    const text = message.text;

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `📄 Please send a PDF to compress.`,
    });

    return res.sendStatus(200);
  }

  // ✅ For other non-PDF, non-text messages (like images, videos)
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `⚠️ I only work with PDF files right now. Please send a PDF.`,
  });

  return res.sendStatus(200);
});
