const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const { kv } = require('@vercel/kv');
const http = require('http');

const token = '8198315538:AAEuudupt-LwuF48PQvZ4Nmx9n9fFMVWpLA'; // Replace with your bot token
const groupId = '1002288817447'; // Replace with your group ID
const groupName = 'Influenz Education';

const bot = new TelegramBot(token, { polling: true });

// Create a simple HTTP server to keep the process alive on Vercel
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!\n');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

console.log('Bot is running...');

// Command handlers
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() === groupId) {
    bot.sendMessage(chatId, `Welcome to ${groupName}! 🎉 I’m @InfluenzQuizMaster_bot, here to test your Web3 and crypto knowledge. Use /help to see commands!`);
  }
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  if (chatId.toString() === groupId) {
    bot.sendMessage(chatId, `Here are the commands for ${groupName}:\n/start - Start the bot\n/help - Show this message\n/checkscore - Check your score\n\nI post Web3 questions 3 times a day (8 AM, 2 PM, 8 PM GMT, Mon-Fri). Answer within 30 minutes to earn points! Weekly top 5 on Saturdays, monthly top 3 at month-end.`);
  }
});

bot.onText(/\/checkscore/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;
  if (chatId.toString() === groupId) {
    const score = (await kv.get(`score:${userId}`)) || 0;
    bot.sendMessage(chatId, `@${username}, you have ${score} points! Keep up the great work in ${groupName}! 🚀`);
  }
});

// Load questions
const questions = require('./questions.json');

// Track active question
let activeQuestion = null;

// Schedule announcements and questions
cron.schedule('30 7,13,19 * * 1-5', () => {
  bot.sendMessage(groupId, 'Get ready! A new Web3 question drops in 30 minutes! 🚀');
}, { timezone: 'GMT' });

cron.schedule('0 8,14,20 * * 1-5', () => {
  const today = new Date().toLocaleString('en-US', { weekday: 'long', timeZone: 'GMT' });
  const currentTime = new Date().toLocaleString('en-US', { hour: 'numeric', minute: 'numeric', hour12: false, timeZone: 'GMT' });
  const question = questions.find(q => q.day === today && q.time === currentTime);
  if (question) {
    activeQuestion = question;
    bot.sendMessage(groupId, `Here’s the question: ${question.question}\nReply with your answer! (30 minutes to answer)`);
  }
}, { timezone: 'GMT' });

// Handle answers
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;
  if (chatId.toString() === groupId && activeQuestion && msg.text && !msg.text.startsWith('/')) {
    const userAnswer = msg.text.trim().toLowerCase();
    const correctAnswer = activeQuestion.answer.toLowerCase();
    if (userAnswer === correctAnswer) {
      const scoreKey = `score:${userId}`;
      const score = (await kv.get(scoreKey)) || 0;
      await kv.set(scoreKey, score + 1);
      bot.sendMessage(chatId, `Nice one, @${username}! You’ve earned 1 point for answering correctly! 🎉 Check your score with /checkscore`);
    } else {
      bot.sendMessage(chatId, `Sorry, @${username}, that’s incorrect. The answer was *${activeQuestion.answer}*. Try the next one!`, { parse_mode: 'Markdown' });
    }
    activeQuestion = null;
  }
});

// Timeout for questions
cron.schedule('30 8,14,20 * * 1-5', () => {
  if (activeQuestion) {
    bot.sendMessage(groupId, `Time’s up! The answer was *${activeQuestion.answer}*. Stay tuned for the next question!`, { parse_mode: 'Markdown' });
    activeQuestion = null;
  }
}, { timezone: 'GMT' });

// Weekly leaderboard (Saturday 10 AM GMT)
cron.schedule('0 10 * * 6', async () => {
  const scores = {};
  for await (const key of kv.scanIterator({ match: 'score:*' })) {
    const userId = key.split(':')[1];
    const score = await kv.get(key);
    const username = (await bot.getChatMember(groupId, userId)).user.username || (await bot.getChatMember(groupId, userId)).user.first_name;
    scores[username] = score;
  }
  const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (sortedScores.length > 0) {
    const leaderboard = sortedScores.map(([username, score], index) => `${index + 1}. @${username}: ${score} points`).join('\n');
    bot.sendMessage(groupId, `🏆 Weekly Leaderboard for ${groupName} 🏆\nTop 5 this week:\n${leaderboard}\nKeep up the great work! 🚀`);
  }
}, { timezone: 'GMT' });

// Monthly leaderboard and reset (last day of the month at 10 AM GMT)
cron.schedule('0 10 28-31 * *', async () => {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (tomorrow.getDate() === 1) {
    const scores = {};
    for await (const key of kv.scanIterator({ match: 'score:*' })) {
      const userId = key.split(':')[1];
      const score = await kv.get(key);
      const username = (await bot.getChatMember(groupId, userId)).user.username || (await bot.getChatMember(groupId, userId)).user.first_name;
      scores[username] = score;
    }
    const sortedScores = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (sortedScores.length > 0) {
      const leaderboard = sortedScores.map(([username, score], index) => `${index + 1}. @${username}: ${score} points`).join('\n');
      bot.sendMessage(groupId, `🏆 Monthly Leaderboard for ${groupName} 🏆\nTop 3 this month:\n${leaderboard}\nScores will now reset for a new month! 🚀`);
    }
    for await (const key of kv.scanIterator({ match: 'score:*' })) {
      await kv.set(key, 0);
    }
  }
}, { timezone: 'GMT' });