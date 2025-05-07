require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const http = require('http');
const questions = require('./questions.json');

const token = process.env.BOT_TOKEN;
const groupId = process.env.GROUP_ID;
const groupName = 'Influenz Education';
const adminUsername = '@kryptwriter';

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

// Format question for posting
function formatQuestion(questionText) {
  const [question, options] = questionText.split(' A) ');
  const [optA, rest] = options.split(' B) ');
  const [optB, rest2] = rest.split(' C) ');
  const [optC, optD] = rest2.split(' D) ');
  return `Here’s the question: *${question.trim()}*\nA) ${optA.trim()}\nB) ${optB.trim()}\nC) ${optC.trim()}\nD) ${optD.trim()}\nReply with the letter (A, B, C, or D)!`;
}

// Auto-delete messages after 2 minutes
async function autoDeleteMessages(chatId, userMessageId, botMessageId) {
  setTimeout(async () => {
    try {
      await bot.deleteMessage(chatId, userMessageId);
      await bot.deleteMessage(chatId, botMessageId);
      console.log(`Deleted messages: user=${userMessageId}, bot=${botMessageId}`);
    } catch (err) {
      console.error('Error deleting messages:', err.message);
    }
  }, 120000); // 2 minutes
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

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    const userMessageId = msg.message_id;
    const response = await bot.sendMessage(groupId, "Commands:\n/start - Start the bot\n/help - Show commands\n/checkscore - Check your score\n/leaderboard - View top 5 scorers");
    await autoDeleteMessages(groupId, userMessageId, response.message_id);
    console.log('Sent /help response with auto-delete');
  }
});

bot.onText(/\/checkscore/, async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    const score = scores[userId] || 0;
    const userMessageId = msg.message_id;
    const response = await bot.sendMessage(groupId, `@${username}, you have ${score} points! Keep answering to earn more. 🏆`);
    await autoDeleteMessages(groupId, userMessageId, response.message_id);
    console.log(`Sent /checkscore response for ${username}: ${score} points with auto-delete`);
  }
});

bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    const userMessageId = msg.message_id;
    const leaderboard = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([userId, score], index) => `${index + 1}. @${scores[userId]?.username || 'Unknown'} - ${score} points`)
      .join('\n');
    const message = leaderboard ? `🏆 *Leaderboard (Top 5)* 🏆\n${leaderboard}` : '🏆 *Leaderboard (Top 5)* 🏆\nNo scores yet!';
    const response = await bot.sendMessage(groupId, message);
    await autoDeleteMessages(groupId, userMessageId, response.message_id);
    console.log('Sent /leaderboard response with auto-delete');
  }
});

bot.onText(/\/clearleaderboard/, async (msg) => {
  const chatId = msg.chat.id.toString();
  if (chatId === groupId) {
    const username = msg.from.username;
    if (username === adminUsername) {
      scores = {};
      saveScores();
      await bot.sendMessage(groupId, '🏆 Leaderboard cleared by admin! 🏆');
      console.log(`Leaderboard cleared by ${username}`);
    } else {
      await bot.sendMessage(groupId, `@${username}, only admins can clear the leaderboard.`);
      console.log(`Unauthorized /clearleaderboard attempt by ${username}`);
    }
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
        scores[userId] = { score: scores[userId], username }; // Store username for leaderboard
        saveScores();
        await bot.sendMessage(groupId, `🎉 @${username} is the first to answer correctly! The answer is ${answer}. You now have ${scores[userId].score} points.`);
        console.log(`Correct answer from ${username} for question "${question.question}", new score: ${scores[userId].score}`);
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

    console.log(`Current state: Day=${day}, Time=${time}, AnnouncedQuestions=${JSON.stringify(announcedQuestions)}`);

    const questionsToPost = announcedQuestions.filter(q => {
      const [announceHour, announceMinute] = q.announceTime.split(':').map(Number);
      const [currentHour, currentMinute] = time.split(':').map(Number);
      const announceDate = new Date(now);
      announceDate.setUTCHours(announceHour, announceMinute);
      const questionTime = new Date(announceDate.getTime() + 30 * 60 * 1000);
      const questionTimeStr = questionTime.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
      const currentTimeInMs = now.getTime();
      const questionTimeInMs = questionTime.getTime();
      const timeDiffInMinutes = Math.abs((currentTimeInMs - questionTimeInMs) / (1000 * 60));
      const matches = q.day === day && timeDiffInMinutes <= 2;
      console.log(`Checking announced question: Day=${q.day}, AnnounceTime=${q.announceTime}, QuestionTime=${questionTimeStr}, TimeDiff=${timeDiffInMinutes}min, Matches=${matches}`);
      return matches;
    });

    if (questionsToPost.length > 0) {
      for (const question of questionsToPost) {
        console.log(`Found question to post: ${question.question}`);
        activeQuestions.push({ ...question, answered: false });
        await bot.sendMessage(groupId, formatQuestion(question.question))
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

// Schedule leaderboard posting on Saturdays at 8:00 AM and 8:00 PM WAT (7:00 AM and 7:00 PM UTC)
cron.schedule('0 7,19 * * 6', async () => {
  try {
    console.log('Leaderboard cron triggered at ' + new Date().toISOString());
    const leaderboard = Object.entries(scores)
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, 5)
      .map(([userId, data], index) => `${index + 1}. @${data.username || 'Unknown'} - ${data.score} points`)
      .join('\n');
    const message = leaderboard ? `🏆 *Leaderboard (Top 5)* 🏆\n${leaderboard}` : '🏆 *Leaderboard (Top 5)* 🏆\nNo scores yet!';
    await bot.sendMessage(groupId, message);
    console.log('Posted scheduled leaderboard');
  } catch (err) {
    console.error('Leaderboard cron error:', err.message);
  }
}, {
  timezone: 'Africa/Lagos' // WAT
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});