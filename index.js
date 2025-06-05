require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

const TELEGRAM_API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

// Webhook endpoint to receive messages
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  const chatId = message.chat.id;
  const text = message.text;

  console.log("Received message:", text);

  // Example bot reply
  await axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id: chatId,
    text: `You said: ${text}`,
  });

  return res.sendStatus(200);
});

// Health check
app.get("/", (req, res) => {
  res.send("Bot is live!");
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});
