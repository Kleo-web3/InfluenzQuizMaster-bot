require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const kv = require('@vercel/kv');
const questions = require('./questions.json');

const token = process.env.BOT_TOKEN;
const groupId = process.env.GROUP_ID;
const groupName = 'Influenz Education';

const bot = new TelegramBot(token, { polling: false });

// Health check endpoint
module.exports = async (req, res) => {
  console.log('Health check accessed');
  res.status(200).send('Bot is running!');

  // Run cron job in serverless environment
  cron.schedule('* * * * *', async () => {
    console.log('Cron job triggered');
    const now = new Date();
    const day = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

    console.log(`Checking for question: Day=${day}, Time=${time}`);
    const question = questions.find(q => q.day === day && q.time === time);
    if (question) {
      console.log(`Found question: ${question.question}`);
      await bot.sendMessage(groupId, `🔔 *Announcement*: A new question will be posted in 30 minutes! Get ready.`);
      setTimeout(async () => {
        global.currentQuestion = question;
        await bot.sendMessage(groupId, `Here’s the question: *${question.question}*\nReply with your answer!`);
        console.log(`Posted question: ${question.question}`);
      }, 30 * 60 * 1000);
    } else {
      console.log('No question found for this time');
    }
  });
};