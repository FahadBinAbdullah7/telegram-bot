require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(bodyParser.json());

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const TELEGRAM_FILE_API = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}`;

const userFiles = {};

app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message) return res.sendStatus(200);

  const chatId = message.chat.id;

  // If user sends a PDF document
  if (message.document && message.document.mime_type === "application/pdf") {
    const fileId = message.document.file_id;
    const fileName = message.document.file_name || `file_${Date.now()}.pdf`;

    try {
      // Get file path from Telegram
      const { data } = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
      const filePath = data.result.file_path;

      // Download the file
      const fileUrl = `${TELEGRAM_FILE_API}/${filePath}`;
      const fileResponse = await axios.get(fileUrl, { responseType: "arraybuffer" });

      // Save file buffer to user's list
      if (!userFiles[chatId]) userFiles[chatId] = [];
      userFiles[chatId].push(fileResponse.data);

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: `${fileName} received. Send /merge when done.`,
      });
    } catch (err) {
      console.error("Error receiving file:", err.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ Failed to download PDF. Try again.",
      });
    }

    return res.sendStatus(200);
  }

  // Merge command
  if (message.text && message.text.toLowerCase() === "/merge") {
    if (!userFiles[chatId] || userFiles[chatId].length === 0) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "⚠️ No PDFs found. Please send some files first.",
      });
      return res.sendStatus(200);
    }

    try {
      const mergedPdf = await PDFDocument.create();

      for (const pdfBuffer of userFiles[chatId]) {
        const pdf = await PDFDocument.load(pdfBuffer);
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();
      const outputPath = path.join(__dirname, `merged_${chatId}.pdf`);
      fs.writeFileSync(outputPath, mergedPdfBytes);

      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("document", fs.createReadStream(outputPath));

      await axios.post(`${TELEGRAM_API}/sendDocument`, form, {
        headers: form.getHeaders(),
      });

      fs.unlinkSync(outputPath); // Clean up
      delete userFiles[chatId]; // Clear memory
    } catch (err) {
      console.error("Merge error:", err.message);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "❌ Failed to merge PDFs.",
      });
    }

    return res.sendStatus(200);
  }

  // Default reply
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: "📄 Send PDF files or type /merge to combine them.",
  });

  res.sendStatus(200);
});

// Health check
app.get("/", (req, res) => {
  res.send("PDF Merger Bot is live!");
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
