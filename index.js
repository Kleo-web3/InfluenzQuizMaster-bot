const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const kv = require('@vercel/kv');
const http = require('http');

const token = '8198315538:AAEuudupt-LwuF48PQvZ4Nmx9n9fFMVWpLA';
const groupId = '-1002288817447'; // Added the negative sign as Telegram group IDs are typically negative
const groupName = 'Influenz Education';
const questions = require('./questions.json');

// Initialize bot with webhooks (no polling)
const bot = new TelegramBot(token, { polling: false });

// Vercel deployment URL
const webhookUrl = 'https://influenzquizmaster-bot-kleo-web3.vercel.app';

// Set webhook
bot.setWebHook(`${webhookUrl}/bot${token}`);

// Create an HTTP server to handle webhook requests
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === `/bot${token}`) {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const update = JSON.parse(body);
      bot.processUpdate(update);
      res.writeHead(200);
      res.end('OK');
    });
  } else {
    res.writeHead(200);
    res.end('Bot is running!');
  }
});

// Listen on Vercel-assigned port
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Bot is running...');
});

// Command handlers
bot.onText(/\/start/, (msg) => {
  if (msg.chat.id.toString() === groupId) {
    bot.sendMessage(groupId, `Welcome to ${groupName}! 🎉 I’m @InfluenzQuizMaster_bot...`);
  }
});

bot.onText(/\/help/, (msg) => {
  if (msg.chat.id.toString() === groupId) {
    bot.sendMessage(groupId, "Commands:\n/start - Start the bot\n/help - Show commands\n/checkscore - Check your score");
  }
});

bot.onText(/\/checkscore/, async (msg) => {
  if (msg.chat.id.toString() === groupId) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const score = (await kv.get(`score:${userId}`)) || 0;
    bot.sendMessage(groupId, `@${username}, you have ${score} points! Keep answering to earn more. 🏆`);
  }
});

// Answer handling
let currentQuestion = null;

bot.on('message', async (msg) => {
  if (msg.chat.id.toString() === groupId && currentQuestion && msg.text) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const answer = msg.text.toLowerCase().trim();

    if (answer === currentQuestion.answer.toLowerCase()) {
      const score = (await kv.get(`score:${userId}`)) || 0;
      await kv.set(`score:${userId}`, score + 1);
      bot.sendMessage(groupId, `Nice one, @${username}! 🎉 That’s correct. You now have ${score + 1} points.`);
      currentQuestion = null;
    }
  }
});

// Schedule questions
cron.schedule('* * * * *', () => {
  const now = new Date();
  const day = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

  const question = questions.find(q => q.day === day && q.time === time);
  if (question) {
    bot.sendMessage(groupId, `🔔 *Announcement*: A new question will be posted in 30 minutes! Get ready.`);
    setTimeout(() => {
      currentQuestion = question;
      bot.sendMessage(groupId, `Here’s the question: *${question.question}*\nReply with your answer!`);
    }, 30 * 60 * 1000);
  }
});