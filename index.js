require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { PDFDocument } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const app = express();

app.use(express.json());

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;
const TEMP_DIR = path.join(__dirname, "temp");

// Store uploaded PDFs per user
const userFiles = new Map();

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Helper: Download PDF
async function downloadFile(fileId, filename) {
  const res = await axios.get(`${TELEGRAM_API}/getFile?file_id=${fileId}`);
  const filePath = res.data.result.file_path;
  const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${filePath}`;
  const filePathLocal = path.join(TEMP_DIR, filename);
  const writer = fs.createWriteStream(filePathLocal);

  const response = await axios.get(url, { responseType: "stream" });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(filePathLocal));
    writer.on("error", reject);
  });
}

// Merge PDFs
async function mergePdfs(filePaths) {
  const mergedPdf = await PDFDocument.create();

  for (const filePath of filePaths) {
    const pdfBytes = fs.readFileSync(filePath);
    const pdf = await PDFDocument.load(pdfBytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    pages.forEach(page => mergedPdf.addPage(page));
  }

  const mergedBytes = await mergedPdf.save();
  const mergedPath = path.join(TEMP_DIR, `merged_${Date.now()}.pdf`);
  fs.writeFileSync(mergedPath, mergedBytes);
  return mergedPath;
}

// Webhook handler
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.chat || !message.chat.id) return res.sendStatus(200);

  const chatId = message.chat.id;

  // Handle PDF file upload
  if (message.document && message.document.mime_type === "application/pdf") {
    const fileId = message.document.file_id;
    const fileName = `${chatId}_${Date.now()}.pdf`;

    const filePath = await downloadFile(fileId, fileName);
    if (!userFiles.has(chatId)) userFiles.set(chatId, []);
    userFiles.get(chatId).push(filePath);

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `PDF received! Send more or type /merge to combine.`,
    });
  }

  // Merge command
  else if (message.text === "/merge") {
    const files = userFiles.get(chatId);
    if (!files || files.length === 0) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "No PDFs found. Please send some files first.",
      });
      return res.sendStatus(200);
    }

    const mergedPath = await mergePdfs(files);

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("document", fs.createReadStream(mergedPath));

    await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
      headers: formData.getHeaders(),
    });

    // Cleanup
    files.forEach(file => fs.unlinkSync(file));
    fs.unlinkSync(mergedPath);
    userFiles.delete(chatId);
  }

  // Help message
  else if (message.text === "/start" || message.text === "/help") {
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "📎 Send me PDF files one by one. Then type /merge to get the merged PDF.",
    });
  }

  res.sendStatus(200);
});

// Health check
app.get("/", (req, res) => res.send("PDF Merger Bot is running."));

app.listen(process.env.PORT, () =>
  console.log(`Server running on port ${process.env.PORT}`)
);
