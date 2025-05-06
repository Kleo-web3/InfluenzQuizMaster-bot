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
    bot.sendMessage(groupId, `Welcome to ${groupName}! 🎉 I’m @InfluenzQuizMaster_bot. Use /help for commands.`)
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

// Track active questions and winners
let activeQuestions = [];
let announcedQuestions = [];

// Answer handling
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId && activeQuestions.length > 0 && msg.text && !msg.text.startsWith('/')) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const answer = msg.text.toUpperCase().trim();

    for (let i = 0; i < activeQuestions.length; i++) {
      const question = activeQuestions[i];
      if (!question.answered && answer === question.answer.toUpperCase()) {
        question.answered = true;
        scores[userId] = (scores[userId] || 0) + 1;
        saveScores();
        await bot.sendMessage(groupId, `🎉 @${username} is the first to answer correctly! The answer is ${answer}. You now have ${scores[userId]} points.`);
        console.log(`Correct answer from ${username} for question "${question.question}", new score: ${scores[userId]}`);
        activeQuestions.splice(i, 1); // Remove answered question
        break;
      } else if (!question.answered) {
        console.log(`Incorrect answer from ${username}: ${answer} for question "${question.question}"`);
      }
    }
  }
});

// Schedule announcement
cron.schedule('* * * * *', async () => {
  try {
    console.log('Announcement cron triggered at ' + new Date().toISOString());
    const now = new Date();
    const day = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

    console.log(`Checking questions: Day=${day}, Time=${time}, Questions=${JSON.stringify(questions)}`);
    const matchingQuestions = questions.filter(q => {
      const matches = q.day === day && q.time === time;
      console.log(`Checking question: Day=${q.day}, Time=${q.time}, Matches=${matches}`);
      return matches;
    });

    if (matchingQuestions.length > 0) {
      console.log(`Found ${matchingQuestions.length} questions for announcement`);
      await bot.sendMessage(groupId, `🔔 *Announcement*: ${matchingQuestions.length} new question${matchingQuestions.length > 1 ? 's' : ''} will be posted in 30 minutes! Get ready.`)
        .then(() => {
          console.log('Sent announcement');
          matchingQuestions.forEach(q => announcedQuestions.push({ ...q, announceTime: time }));
        })
        .catch((err) => console.error('Error sending announcement:', err.message));
    } else {
      console.log('No question found for announcement');
    }
  } catch (err) {
    console.error('Announcement cron error:', err.message);
  }
});

// Schedule question posting
cron.schedule('* * * * *', async () => {
  try {
    console.log('Question cron triggered at ' + new Date().toISOString());
    const now = new Date();
    const day = now.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const time = now.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });

    const questionsToPost = announcedQuestions.filter(q => {
      const [announceHour, announceMinute] = q.announceTime.split(':').map(Number);
      const [currentHour, currentMinute] = time.split(':').map(Number);
      const announceDate = new Date(now);
      announceDate.setUTCHours(announceHour, announceMinute);
      const questionTime = new Date(announceDate.getTime() + 30 * 60 * 1000);
      const questionTimeStr = questionTime.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
      const matches = q.day === day && questionTimeStr === time;
      console.log(`Checking announced question: Day=${q.day}, AnnounceTime=${q.announceTime}, QuestionTime=${questionTimeStr}, Matches=${matches}`);
      return matches;
    });

    if (questionsToPost.length > 0) {
      for (const question of questionsToPost) {
        console.log(`Found question to post: ${question.question}`);
        activeQuestions.push({ ...question, answered: false });
        await bot.sendMessage(groupId, `Here’s the question: *${question.question}*\nReply with the letter (A, B, C, or D)! First correct answer wins!`)
          .then(() => {
            console.log(`Posted question: ${question.question}`);
          })
          .catch((err) => console.error('Error posting question:', err.message));
      }
      announcedQuestions = announcedQuestions.filter(q => !questionsToPost.includes(q));
    } else {
      console.log('No question to post at this time');
    }
  } catch (err) {
    console.error('Question cron error:', err.message);
  }
});

// HTTP server for Render
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
    console.log('Health check endpoint accessed');
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running!');
  }
});

const PORT = process.env.PORT || 10000; // Match Render's port
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});