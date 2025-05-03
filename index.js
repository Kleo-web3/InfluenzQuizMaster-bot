require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const http = require('http');
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

// Load or initialize scores
const scoresFile = 'scores.json';
let scores = {};
if (fs.existsSync(scoresFile)) {
  scores = JSON.parse(fs.readFileSync(scoresFile));
}

// Save scores to file
function saveScores() {
  fs.writeFileSync(scoresFile, JSON.stringify(scores, null, 2));
}

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
    const score = scores[userId] || 0;
    await bot.sendMessage(groupId, `@${username}, you have ${score} points! Keep answering to earn more. 🏆`);
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
      scores[userId] = (scores[userId] || 0) + 1;
      saveScores();
      await bot.sendMessage(groupId, `Nice one, @${username}! 🎉 That’s correct. You now have ${scores[userId]} points.`);
      global.currentQuestion = null;
      console.log(`Correct answer from ${username}, new score: ${scores[userId]}`);
    } else {
      console.log(`Incorrect answer from ${username}: ${answer}`);
    }
  }
});

// Schedule questions
cron.schedule('* * * * *', async () => {
  try {
    console.log('Cron job triggered at ' + new Date().toISOString());
    const now = new Date();
    const day = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

    console.log(`Checking questions: Day=${day}, Time=${time}, Questions=${JSON.stringify(questions)}`);
    const question = questions.find(q => {
      const matches = q.day === day && q.time === time;
      console.log(`Checking question: Day=${q.day}, Time=${q.time}, Matches=${matches}`);
      return matches;
    });

    if (question) {
      console.log(`Found question: ${question.question}`);
      await bot.sendMessage(groupId, `🔔 *Announcement*: A new question will be posted in 30 minutes! Get ready.`)
        .then(() => console.log('Sent announcement'))
        .catch((err) => console.error('Error sending announcement:', err.message));
      setTimeout(async () => {
        global.currentQuestion = question;
        await bot.sendMessage(groupId, `Here’s the question: *${question.question}*\nReply with your answer!`)
          .then(() => console.log(`Posted question: ${question.question}`))
          .catch((err) => console.error('Error posting question:', err.message));
      }, 30 * 60 * 1000);
    } else {
      console.log('No question found for this time');
    }
  } catch (err) {
    console.error('Cron job error:', err.message);
  }
});

// HTTP server for Render
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Bot is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});