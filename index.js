require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_ID = process.env.GROUP_ID || '-1002288817447';
const ADMIN_USERNAME = '@kryptwriter';
const SCORES_FILE = path.join(__dirname, 'scores.json');
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');

let scores = {};
let questions = [];
let currentQuestion = null;

// Load scores from file
async function loadScores() {
  try {
    const data = await fs.readFile(SCORES_FILE, 'utf8');
    scores = JSON.parse(data) || {};
  } catch (error) {
    console.error('Error loading scores:', error);
    scores = {};
  }
}

// Save scores to file
async function saveScores() {
  try {
    await fs.writeFile(SCORES_FILE, JSON.stringify(scores, null, 2));
  } catch (error) {
    console.error('Error saving scores:', error);
  }
}

// Load questions from file
async function loadQuestions() {
  try {
    const data = await fs.readFile(QUESTIONS_FILE, 'utf8');
    questions = JSON.parse(data);
    console.log(`Loaded ${questions.length} questions`);
  } catch (error) {
    console.error('Error loading questions:', error);
    questions = [];
  }
}

// Format question for Telegram
function formatQuestion(q) {
  return `Here’s the question: *${q.question.split(' A)')[0]}*\n` +
         `A) ${q.question.split(' A) ')[1].split(' B) ')[0]}\n` +
         `B) ${q.question.split(' B) ')[1].split(' C) ')[0]}\n` +
         `C) ${q.question.split(' C) ')[1].split(' D) ')[0]}\n` +
         `D) ${q.question.split(' D) ')[1]}\n` +
         `Reply with the letter (A, B, C, or D)!`;
}

// Post announcement 30 minutes before question
async function postAnnouncement(question) {
  try {
    await bot.telegram.sendMessage(GROUP_ID, `Quiz question coming up in 30 minutes at ${question.time} UTC! Get ready!`);
  } catch (error) {
    console.error('Error posting announcement:', error);
  }
}

// Post question and set current question
async function postQuestion(question) {
  try {
    await bot.telegram.sendMessage(GROUP_ID, formatQuestion(question));
    currentQuestion = question;
  } catch (error) {
    console.error('Error posting question:', error);
  }
}

// Schedule questions
async function scheduleQuestions() {
  await loadQuestions();
  if (questions.length === 0) {
    console.error('No questions to schedule');
    return;
  }
  questions.forEach((q) => {
    const [hour, minute] = q.time.split(':').map(Number);
    let announceMinute = minute - 30;
    let announceHour = hour;
    if (announceMinute < 0) {
      announceMinute += 60;
      announceHour -= 1;
      if (announceHour < 0) announceHour += 24;
    }
    const cronTime = `${announceMinute} ${announceHour} * * ${q.day}`;
    const questionCronTime = `${minute} ${hour} * * ${q.day}`;
    cron.schedule(cronTime, () => postAnnouncement(q), { timezone: 'UTC' });
    cron.schedule(questionCronTime, () => postQuestion(q), { timezone: 'UTC' });
  });
}

// Handle answers
bot.on('text', async (ctx) => {
  if (String(ctx.chat.id) !== GROUP_ID || !currentQuestion) {
    return;
  }

  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  const answer = ctx.message.text.trim().toUpperCase();

  if (!['A', 'B', 'C', 'D'].includes(answer)) {
    return;
  }

  if (!scores[userId]) {
    scores[userId] = { username, points: 0 };
  }

  try {
    if (answer === currentQuestion.answer) {
      scores[userId].points += 1;
      await saveScores();
      await ctx.reply(`Correct, ${username}! You've earned 1 point.`);
    } else {
      await ctx.reply(`Sorry, ${username}, that's incorrect. Try the next one!`);
    }
  } catch (error) {
    console.error('Error handling answer:', error);
  }
});

// Commands
bot.command('start', async (ctx) => {
  if (String(ctx.chat.id) === GROUP_ID) {
    try {
      await ctx.reply('Quiz bot started! Questions will be posted in the group.');
    } catch (error) {
      console.error('Error in /start:', error);
    }
  }
});

bot.command('leaderboard', async (ctx) => {
  if (String(ctx.chat.id) !== GROUP_ID) {
    return;
  }

  try {
    const sortedScores = Object.values(scores)
      .sort((a, b) => b.points - a.points)
      .slice(0, 5);

    let message = '🏆 *Leaderboard (Top 5)* 🏆\n\n';
    message += 'Username         Points\n';
    sortedScores.forEach((s) => {
      message += `${s.username.padEnd(15)} ${s.points}\n`;
    });

    const sentMessage = await ctx.reply(message, { parse_mode: 'Markdown' });
    setTimeout(() => {
      bot.telegram.deleteMessage(GROUP_ID, sentMessage.message_id).catch(console.error);
    }, 2 * 60 * 1000);
  } catch (error) {
    console.error('Error in /leaderboard:', error);
  }
});

bot.command('checkscore', async (ctx) => {
  if (String(ctx.chat.id) !== GROUP_ID) {
    return;
  }

  try {
    const userId = ctx.from.id;
    const score = scores[userId]?.points || 0;
    await ctx.reply(`Your current score is ${score} points.`);
  } catch (error) {
    console.error('Error in /checkscore:', error);
  }
});

bot.command('clearleaderboard', async (ctx) => {
  if (String(ctx.chat.id) !== GROUP_ID || ctx.from.username !== ADMIN_USERNAME) {
    return;
  }

  try {
    scores = {};
    await saveScores();
    await ctx.reply('Leaderboard cleared!');
  } catch (error) {
    console.error('Error in /clearleaderboard:', error);
  }
});

bot.command('help', async (ctx) => {
  if (String(ctx.chat.id) !== GROUP_ID) {
    return;
  }

  try {
    await ctx.reply(
      'Welcome to the Influenz Quiz Bot!\n' +
      '- Questions are posted in the group.\n' +
      '- Reply with A, B, C, or D to answer.\n' +
      '- Commands:\n' +
      '  /leaderboard - View top 5 scores\n' +
      '  /checkscore - Check your score\n' +
      '  /help - Show this message'
    );
  } catch (error) {
    console.error('Error in /help:', error);
  }
});

// Weekly leaderboard on Saturday
cron.schedule('0 7,19 * * 6', async () => {
  try {
    const sortedScores = Object.values(scores)
      .sort((a, b) => b.points - a.points)
      .slice(0, 5);

    let message = '🏆 *Weekly Leaderboard (Top 5)* 🏆\n\n';
    message += 'Username         Points\n';
    sortedScores.forEach((s) => {
      message += `${s.username.padEnd(15)} ${s.points}\n`;
    });

    const sentMessage = await bot.telegram.sendMessage(GROUP_ID, message, { parse_mode: 'Markdown' });
    setTimeout(() => {
      bot.telegram.deleteMessage(GROUP_ID, sentMessage.message_id).catch(console.error);
    }, 2 * 60 * 1000);
  } catch (error) {
    console.error('Error posting weekly leaderboard:', error);
  }
}, { timezone: 'UTC' });

// Start bot
async function startBot() {
  await loadScores();
  await scheduleQuestions();
  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log('Bot started with polling');
  } catch (error) {
    console.error('Failed to start bot:', error);
  }
}

// Express server for Render
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 10000, () => console.log(`Server running on port ${process.env.PORT || 10000}`));

startBot().catch(console.error);