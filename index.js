require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const kv = require('@vercel/kv');
const questions = require('./questions.json');

const token = process.env.BOT_TOKEN;
const groupId = process.env.GROUP_ID;
const groupName = 'Influenz Education';

// Initialize bot with polling
const bot = new TelegramBot(token, { polling: true });

// Command handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    bot.sendMessage(groupId, `Welcome to ${groupName}! 🎉 I’m @InfluenzQuizMaster_bot...`);
    console.log('Sent /start response');
  }
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    bot.sendMessage(groupId, "Commands:\n/start - Start the bot\n/help - Show commands\n/checkscore - Check your score");
    console.log('Sent /help response');
  }
});

bot.onText(/\/checkscore/, async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const score = (await kv.get(`score:${userId}`)) || 0;
    bot.sendMessage(groupId, `@${username}, you have ${score} points! Keep answering to earn more. 🏆`);
    console.log(`Sent /checkscore response for ${username}: ${score} points`);
  }
});

// Answer handling
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId && global.currentQuestion && msg.text && !msg.text.startsWith('/')) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const answer = msg.text.toLowerCase().trim();

    if (answer === global.currentQuestion.answer.toLowerCase()) {
      const score = (await kv.get(`score:${userId}`)) || 0;
      await kv.set(`score:${userId}`, score + 1);
      bot.sendMessage(groupId, `Nice one, @${username}! 🎉 That’s correct. You now have ${score + 1} points.`);
      global.currentQuestion = null;
      console.log(`Correct answer from ${username}, new score: ${score + 1}`);
    } else {
      console.log(`Incorrect answer from ${username}: ${answer}`);
    }
  }
});

// Schedule questions
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

// Health check endpoint
module.exports = async (req, res) => {
  console.log('Health check accessed');
  res.status(200).send('Bot is running!');
};