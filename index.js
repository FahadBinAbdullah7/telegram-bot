require("dotenv").config();
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const FormData = require("form-data");
const { PDFDocument } = require("pdf-lib");

const app = express();
app.use(bodyParser.json());

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const FILE_API = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}`;

const userFiles = {}; // Store user-uploaded PDFs in memory

// Handle incoming Telegram updates
app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message || !message.chat || !message.chat.id) return res.sendStatus(200);

  const chatId = message.chat.id;

  // Handle PDF document uploads
  if (message.document && message.document.mime_type === "application/pdf") {
    const fileId = message.document.file_id;
    const fileName = message.document.file_name;

    try {
      const fileUrl = await getFileUrl(fileId);
      const fileBuffer = await downloadFile(fileUrl);

      if (!userFiles[chatId]) userFiles[chatId] = [];

      userFiles[chatId].push({ name: fileName, buffer: fileBuffer });

      await sendMessage(chatId, `✅ Received: ${fileName}`);
    } catch (err) {
      console.error("Download error:", err);
      await sendMessage(chatId, `❌ Failed to download ${fileName}`);
    }

    return res.sendStatus(200);
  }

  // Handle merge command
  if (message.text && message.text.trim().toLowerCase() === "/merge") {
    const files = userFiles[chatId];
    if (!files || files.length === 0) {
      await sendMessage(chatId, "❌ No PDFs found. Please send some files first.");
      return res.sendStatus(200);
    }

    try {
      const mergedPdf = await PDFDocument.create();

      for (const file of files) {
        const donorPdf = await PDFDocument.load(file.buffer);
        const copiedPages = await mergedPdf.copyPages(donorPdf, donorPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedPdfBytes = await mergedPdf.save();

      // Upload and send PDF back to user
      const mergedBuffer = Buffer.from(mergedPdfBytes);
      const form = new FormData();
      form.append("chat_id", chatId);
      form.append("document", mergedBuffer, "merged.pdf");

      await axios.post(`${TELEGRAM_API}/sendDocument`, form, {
        headers: form.getHeaders(),
      });

      // Clear user session
      delete userFiles[chatId];
    } catch (err) {
      console.error("Merge error:", err);
      await sendMessage(chatId, "❌ Failed to merge PDFs.");
    }

    return res.sendStatus(200);
  }

  // Unknown messages
  await sendMessage(chatId, "📎 Send me some PDF files, then type /merge to combine them.");
  res.sendStatus(200);
});

// Get Telegram file URL
async function getFileUrl(fileId) {
  const res = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const filePath = res.data.result.file_path;
  return `${FILE_API}/${filePath}`;
}

// Download file as buffer
async function downloadFile(fileUrl) {
  const res = await axios.get(fileUrl, { responseType: "arraybuffer" });
  return res.data;
}

// Send a simple message
async function sendMessage(chatId, text) {
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text,
  });
}

// Health check
app.get("/", (req, res) => res.send("PDF Merge Bot is Live!"));

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
