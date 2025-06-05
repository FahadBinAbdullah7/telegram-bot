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

// Webhook endpoint to receive messages
app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message || !message.chat) return res.sendStatus(200);

  const chatId = message.chat.id;

  // If a PDF document is sent
  if (message.document && message.document.mime_type === "application/pdf") {
    const fileId = message.document.file_id;

    try {
      // Get the file path from Telegram
      const fileResp = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
      const filePath = fileResp.data.result.file_path;

      // Download the file
      const fileUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
      const pdfBuffer = (await axios.get(fileUrl, { responseType: "arraybuffer" })).data;

      // Compress using pdf-lib
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      pdfDoc.setTitle(""); // Remove metadata
      const compressedPdf = await pdfDoc.save({ useObjectStreams: true });

      // Save to disk temporarily
      const outputPath = path.join(__dirname, "compressed.pdf");
      fs.writeFileSync(outputPath, compressedPdf);

      // Send the compressed PDF back
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("document", fs.createReadStream(outputPath));

      await axios.post(`${TELEGRAM_API}/sendDocument`, form, {
        headers: form.getHeaders(),
      });

      // Clean up
      fs.unlinkSync(outputPath);
    } catch (err) {
      console.error("Compression error:", err.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ Sorry, failed to compress your PDF. Please try again later.",
      });
    }

    return res.sendStatus(200);
  }

  // If not a PDF, send a default reply
  const text = message.text || "";
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `📄 Please send me a PDF file and I will compress it for you.`,
  });

  return res.sendStatus(200);
});

// Health check route
app.get("/", (req, res) => {
  res.send("🤖 Telegram PDF Compressor Bot is running.");
});

// Start the server
app.listen(process.env.PORT, () => {
  console.log(`🚀 Server running on port ${process.env.PORT}`);
});
