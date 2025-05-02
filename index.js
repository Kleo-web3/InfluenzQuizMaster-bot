require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const kv = require('@vercel/kv');
const questions = require('./questions.json');

const token = process.env.BOT_TOKEN;
const groupId = process.env.GROUP_ID;
const groupName = 'Influenz Education';

// Initialize bot with polling
const bot = new TelegramBot(token, { polling: true });

console.log('Bot started with polling');

// Handle polling errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

// Command handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    bot.sendMessage(groupId, `Welcome to ${groupName}! 🎉 I’m @InfluenzQuizMaster_bot...`)
      .then(() => console.log('Sent /start response'))
      .catch((err) => console.error('Error sending /start:', err.message));
  } else {
    console.log(`Ignored /start from chat ${chatId}`);
  }
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    bot.sendMessage(groupId, "Commands:\n/start - Start the bot\n/help - Show commands\n/checkscore - Check your score")
      .then(() => console.log('Sent /help response'))
      .catch((err) => console.error('Error sending /help:', err.message));
  }
});

bot.onText(/\/checkscore/, async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    try {
      const score = (await kv.get(`score:${userId}`)) || 0;
      await bot.sendMessage(groupId, `@${username}, you have ${score} points! Keep answering to earn more. 🏆`);
      console.log(`Sent /checkscore response for ${username}: ${score} points`);
    } catch (err) {
      console.error('Error in /checkscore:', err.message);
    }
  }
});

// Answer handling
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId && global.currentQuestion && msg.text && !msg.text.startsWith('/')) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const answer = msg.text.toLowerCase().trim();

    try {
      if (answer === global.currentQuestion.answer.toLowerCase()) {
        const score = (await kv.get(`score:${userId}`)) || 0;
        await kv.set(`score:${userId}`, score + 1);
        await bot.sendMessage(groupId, `Nice one, @${username}! 🎉 That’s correct. You now have ${score + 1} points.`);
        global.currentQuestion = null;
        console.log(`Correct answer from ${username}, new score: ${score + 1}`);
      } else {
        console.log(`Incorrect answer from ${username}: ${answer}`);
      }
    } catch (err) {
      console.error('Error handling answer:', err.message);
    }
  }
});

// Health check endpoint
module.exports = async (req, res) => {
  console.log('Health check accessed');
  res.status(200).send('Bot is running!');
};