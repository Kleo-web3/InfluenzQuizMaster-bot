require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const path = require('path');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_ID = process.env.GROUP_ID || '-1002288817447';
const THREAD_ID = '3'; // Discussion/Q and Zone topic
const ADMIN_USERNAME = '@kryptwriter';
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');

let scores = {}; // Store scores in memory
let questions = [];
let currentQuestion = null;
let firstAttempts = new Map(); // Tracks first attempt per user per question
let firstCorrectUser = null; // Tracks first user to answer correctly
let isPolling = false; // Prevent multiple polling instances

// Load questions from file
async function loadQuestions() {
  try {
    const fs = require('fs').promises;
    const exists = await fs.access(QUESTIONS_FILE).then(() => true).catch(() => false);
    if (!exists) {
      console.error('questions.json does not exist');
      questions = [];
      return;
    }
    const data = await fs.readFile(QUESTIONS_FILE, 'utf8');
    questions = JSON.parse(data);
    console.log(`Loaded ${questions.length} questions:`, JSON.stringify(questions, null, 2));
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

// Get current day and time in UTC (WAT is UTC+1)
function getCurrentDayTime() {
  const now = new Date();
  const utc = new Date(now.getTime() + 1 * 60 * 60 * 1000); // WAT offset
  const day = utc.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const time = utc.toLocaleString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return { day, time };
}

// Post announcement 30 minutes before question
async function postAnnouncement(question) {
  console.log(`Posting announcement for question at ${question.time} UTC`);
  try {
    await bot.telegram.sendMessage(GROUP_ID, `Quiz question coming up in 30 minutes at ${question.time} UTC! Get ready!`, {
      message_thread_id: THREAD_ID
    });
    console.log('Announcement posted successfully');
  } catch (error) {
    console.error('Error posting announcement:', error);
  }
}

// Post question and set current question
async function postQuestion(question) {
  console.log(`Posting question at ${question.time} UTC: ${question.question}`);
  try {
    await bot.telegram.sendMessage(GROUP_ID, formatQuestion(question), {
      message_thread_id: THREAD_ID
    });
    currentQuestion = question;
    firstAttempts.clear(); // Reset first attempts for new question
    firstCorrectUser = null; // Reset first correct user
    console.log('Question posted successfully');
  } catch (error) {
    console.error('Error posting question:', error);
  }
}

// Schedule questions
async function scheduleQuestions() {
  await loadQuestions();
  console.log('Scheduling questions...');
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
    console.log(`Scheduled announcement: ${cronTime}, Question: ${questionCronTime}`);
    cron.schedule(cronTime, () => postAnnouncement(q), { timezone: 'UTC' });
    cron.schedule(questionCronTime, () => postQuestion(q), { timezone: 'UTC' });
  });
}

// Handle answers
bot.hears(['A', 'B', 'C', 'D'], async (ctx) => {
  console.log(`Received answer: ${ctx.message.text}, Chat ID: ${ctx.chat.id}, Thread ID: ${ctx.message.message_thread_id}`);
  if (String(ctx.chat.id) !== GROUP_ID || String(ctx.message.message_thread_id) !== THREAD_ID) {
    console.log(`Ignoring answer: Chat ID match: ${String(ctx.chat.id) === GROUP_ID}, Thread ID match: ${String(ctx.message.message_thread_id) === THREAD_ID}`);
    return;
  }

  if (!currentQuestion) {
    console.log('Ignoring answer: No current question active');
    await ctx.reply('No active question right now. Wait for the next quiz!', {
      message_thread_id: THREAD_ID
    });
    return;
  }

  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  const answer = ctx.message.text.trim().toUpperCase();

  // Check if user has already submitted an attempt
  const attemptKey = `${userId}:${currentQuestion.question}`;
  if (firstAttempts.has(attemptKey)) {
    console.log(`User ${username} already attempted: ${attemptKey}`);
    return;
  }

  // Record first attempt
  firstAttempts.set(attemptKey, answer);
  console.log(`Recorded first attempt: ${username} -> ${answer}`);

  // Check answer
  try {
    if (answer === currentQuestion.answer) {
      if (firstCorrectUser === null) {
        // First correct answer
        firstCorrectUser = userId;
        if (!scores[userId]) {
          scores[userId] = { username, points: 0 };
        }
        scores[userId].points += 1;
        await ctx.reply(`Correct, ${username}! You're the first to answer correctly and earned 1 point!`, {
          message_thread_id: THREAD_ID
        });
        console.log(`First correct answer by ${username}, Points: ${scores[userId].points}`);
      } else {
        // Correct but not first
        await ctx.reply(`Correct, ${username}, but someone else was first. Try to be quicker next time!`, {
          message_thread_id: THREAD_ID
        });
        console.log(`Correct answer by ${username}, but not first (first was user ${firstCorrectUser})`);
      }
    } else {
      await ctx.reply(`Sorry, ${username}, that's incorrect. Try the next one!`, {
        message_thread_id: THREAD_ID
      });
      console.log(`Incorrect answer by ${username}`);
    }
  } catch (error) {
    console.error('Error handling answer:', error);
  }
});

// Handle commands
bot.on('message', async (ctx) => {
  if (!ctx.message.text || !ctx.message.text.startsWith('/')) {
    console.log(`Ignoring non-command message: ${ctx.message.text || 'no text'}`);
    return;
  }

  console.log(`Received command: ${ctx.message.text}, Chat ID: ${ctx.chat.id}, Thread ID: ${ctx.message.message_thread_id}, Username: ${ctx.from.username || ctx.from.first_name}`);
  if (String(ctx.chat.id) !== GROUP_ID || String(ctx.message.message_thread_id) !== THREAD_ID) {
    console.log(`Ignoring command: Chat ID match: ${String(ctx.chat.id) === GROUP_ID}, Thread ID match: ${String(ctx.message.message_thread_id) === THREAD_ID}`);
    return;
  }

  const command = ctx.message.text.split(' ')[0].toLowerCase().replace('/', '');

  try {
    if (command === 'start') {
      await ctx.reply('Quiz bot started! Questions will be posted in the Discussion/Q and Zone topic.', {
        message_thread_id: THREAD_ID
      });
      console.log('/start command processed successfully');
    } else if (command === 'help') {
      await ctx.reply(
        'Welcome to the Influenz Quiz Bot!\n' +
        '- Questions are posted in the Discussion/Q and Zone topic.\n' +
        '- Reply with A, B, C, or D to answer.\n' +
        '- Only the first correct answer earns a point.\n' +
        '- Commands:\n' +
        '  /leaderboard - View top 5 scores\n' +
        '  /checkscore - Check your score\n' +
        '  /help - Show this message',
        { message_thread_id: THREAD_ID }
      );
      console.log('/help command processed successfully');
    } else if (command === 'leaderboard') {
      const sortedScores = Object.values(scores)
        .sort((a, b) => b.points - a.points)
        .slice(0, 5);
      let message = '🏆 *Leaderboard (Top 5)* 🏆\n\n';
      message += 'Username         Points\n';
      sortedScores.forEach((s) => {
        message += `${s.username.padEnd(15)} ${s.points}\n`;
      });
      const sentMessage = await ctx.reply(message, {
        parse_mode: 'Markdown',
        message_thread_id: THREAD_ID
      });
      setTimeout(() => {
        bot.telegram.deleteMessage(GROUP_ID, sentMessage.message_id).catch(console.error);
      }, 2 * 60 * 1000); // Delete after 2 minutes
      console.log('/leaderboard command processed successfully');
    } else if (command === 'checkscore') {
      const userId = ctx.from.id;
      const score = scores[userId]?.points || 0;
      await ctx.reply(`Your current score is ${score} points.`, {
        message_thread_id: THREAD_ID
      });
      console.log('/checkscore command processed successfully');
    } else if (command === 'clearleaderboard') {
      if (ctx.from.username !== ADMIN_USERNAME) {
        console.log(`Ignoring /clearleaderboard: User ${ctx.from.username} is not admin`);
        return;
      }
      scores = {};
      await ctx.reply('Leaderboard cleared!', {
        message_thread_id: THREAD_ID
      });
      console.log('/clearleaderboard command processed successfully');
    } else if (command === 'testquestion') {
      if (ctx.from.username !== ADMIN_USERNAME) {
        console.log(`Ignoring /testquestion: User ${ctx.from.username} is not admin`);
        return;
      }
      console.log('Posting test question');
      await postQuestion({
        question: 'Test question? A) A B) B C) C D) D',
        answer: 'C',
        time: 'now'
      });
      console.log('/testquestion command processed successfully');
    } else {
      console.log(`Unknown command: ${command}`);
    }
  } catch (error) {
    console.error(`Error in command ${command}:`, error);
  }
});

// Weekly leaderboard on Saturday
cron.schedule('0 7,19 * * 6', async () => {
  console.log('Posting weekly leaderboard');
  try {
    const sortedScores = Object.values(scores)
      .sort((a, b) => b.points - a.points)
      .slice(0, 5);

    let message = '🏆 *Weekly Leaderboard (Top 5)* 🏆\n\n';
    message += 'Username         Points\n';
    sortedScores.forEach((s) => {
      message += `${s.username.padEnd(15)} ${s.points}\n`;
    });

    const sentMessage = await bot.telegram.sendMessage(GROUP_ID, message, {
      parse_mode: 'Markdown',
      message_thread_id: THREAD_ID
    });
    setTimeout(() => {
      bot.telegram.deleteMessage(GROUP_ID, sentMessage.message_id).catch(console.error);
    }, 2 * 60 * 1000); // Delete after 2 minutes
    console.log('Weekly leaderboard posted successfully');
  } catch (error) {
    console.error('Error posting weekly leaderboard:', error);
  }
}, { timezone: 'UTC' });

// Start bot
async function startBot() {
  if (isPolling) {
    console.log('Polling already active, skipping start');
    return;
  }
  isPolling = true;
  console.log('Starting bot...');
  await scheduleQuestions();
  try {
    await bot.launch({ dropPendingUpdates: true });
    console.log('Bot started with polling');
  } catch (error) {
    console.error('Failed to start bot:', error);
    isPolling = false;
    throw error;
  }
}

// Stop polling on process exit
process.on('SIGINT', async () => {
  console.log('Received SIGINT, stopping bot...');
  if (isPolling) {
    await bot.stop();
    isPolling = false;
    console.log('Bot stopped');
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, stopping bot...');
  if (isPolling) {
    await bot.stop();
    isPolling = false;
    console.log('Bot stopped');
  }
  process.exit(0);
});

// Express server for Render
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 10000, () => console.log(`Server running on port ${process.env.PORT || 10000}`));

startBot().catch(console.error);