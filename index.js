require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const kv = require('@vercel/kv');
const questions = require('./questions.json');

const token = process.env.BOT_TOKEN;
const groupId = process.env.GROUP_ID;
const groupName = 'Influenz Education';

// Initialize bot
const bot = new TelegramBot(token, { polling: false });

// Health check endpoint
module.exports = async (req, res) => {
  res.status(200).send('Bot is running!');
};

// Schedule questions (runs in Vercel’s environment)
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const day = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

  const question = questions.find(q => q.day === day && q.time === time);
  if (question) {
    await bot.sendMessage(groupId, `🔔 *Announcement*: A new question will be posted in 30 minutes! Get ready.`);
    setTimeout(async () => {
      global.currentQuestion = question;
      await bot.sendMessage(groupId, `Here’s the question: *${question.question}*\nReply with your answer!`);
    }, 30 * 60 * 1000);
  }
});