require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const path = require('path');
const express = require('express');

const bot = new Telegraf(process.env.BOT_TOKEN);
const GROUP_ID = process.env.GROUP_ID || '-1002288817447';
const THREAD_ID = '3'; // Discussion/Q and Zone topic
const ADMIN_ID = '5147724876'; // Your Telegram ID
const QUESTIONS_FILE = path.join(__dirname, 'questions.json');
const SCORES_FILE = path.join(__dirname, 'scores.json');

let scores = {}; // Store scores in memory, synced with scores.json
let questions = [];
let currentQuestion = null;
let firstAttempts = new Map(); // Tracks first attempt per user per question
let firstCorrectUser = null; // Tracks first user to answer correctly
let isPolling = false; // Prevent multiple polling instances
let questionTimeout = null; // Tracks question timeout
let scheduledTasks = []; // Store scheduled cron tasks to prevent duplicates
let questionIndex = 0; // Tracks current question for sequential selection

// Load questions from file and shuffle once
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
    questions = shuffleQuestions(questions); // Shuffle once at startup
    console.log(`Loaded and shuffled ${questions.length} questions`);
  } catch (error) {
    console.error('Error loading questions:', error);
    questions = [];
  }
}

// Shuffle questions array (Fisher-Yates)
function shuffleQuestions(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// Load scores from file
async function loadScores() {
  try {
    const fs = require('fs').promises;
    const exists = await fs.access(SCORES_FILE).then(() => true).catch(() => false);
    if (!exists) {
      console.log('scores.json does not exist, initializing empty scores');
      scores = {};
      await saveScores();
      return;
    }
    const data = await fs.readFile(SCORES_FILE, 'utf8');
    scores = JSON.parse(data);
    console.log(`Loaded scores:`, JSON.stringify(scores, null, 2));
  } catch (error) {
    console.error('Error loading scores:', error);
    scores = {};
  }
}

// Save scores to file
async function saveScores() {
  try {
    const fs = require('fs').promises;
    await fs.writeFile(SCORES_FILE, JSON.stringify(scores, null, 2));
    console.log('Scores saved successfully');
  } catch (error) {
    console.error('Error saving scores:', error);
  }
}

// Format time as HH:MM UTC
function formatTime(hour, minute) {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC`;
}

// Get next session details
function getNextSessionDetails(currentSessionName) {
  const sessions = [
    { name: 'Morning', hour: 10, minute: 0 },
    { name: 'Noon', hour: 14, minute: 0 },
    { name: 'Evening', hour: 19, minute: 30 }
  ];
  const currentIndex = sessions.findIndex(s => s.name === currentSessionName);
  const nextIndex = (currentIndex + 1) % sessions.length;
  const nextSession = sessions[nextIndex];
  const isNextDay = nextIndex === 0;

  // Get next day's name for Evening
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date();
  const nextDayIndex = (today.getDay() + 1) % 7;
  const nextDayName = isNextDay ? days[nextDayIndex] : '';

  return {
    name: nextSession.name,
    time: formatTime(nextSession.hour, nextSession.minute),
    isNextDay,
    nextDayName
  };
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

// Get answer description
function getAnswerDescription(q) {
  const options = {
    'A': q.question.split(' A) ')[1].split(' B) ')[0],
    'B': q.question.split(' B) ')[1].split(' C) ')[0],
    'C': q.question.split(' C) ')[1].split(' D) ')[0],
    'D': q.question.split(' D) ')[1]
  };
  return options[q.answer];
}

// Get current day and time in UTC (WAT is UTC+1)
function getCurrentDayTime() {
  const now = new Date();
  const utc = new Date(now.getTime() + 1 * 60 * 60 * 1000); // WAT offset
  const day = utc.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const time = utc.toLocaleString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return { day, time };
}

// Post announcement 30 minutes before session
async function postAnnouncement(sessionTime, sessionName) {
  console.log(`Posting announcement for ${sessionName} session at ${sessionTime} UTC`);
  try {
    await bot.telegram.sendMessage(GROUP_ID, `Quiz session (${sessionName}) with 6 questions starts in 30 minutes at ${sessionTime} UTC! Get ready!`, {
      message_thread_id: THREAD_ID
    });
    console.log(`Announcement for ${sessionName} session posted successfully`);
  } catch (error) {
    console.error(`Error posting announcement for ${sessionName} session:`, error);
  }
}

// Post question and set current question
async function postQuestion(question) {
  console.log(`Posting question: ${question.question}`);
  try {
    await bot.telegram.sendMessage(GROUP_ID, formatQuestion(question), {
      message_thread_id: THREAD_ID
    });
    currentQuestion = question;
    firstAttempts.clear(); // Reset first attempts for new question
    firstCorrectUser = null; // Reset first correct user
    console.log('Question posted successfully');

    // Set timeout to close question after 5 minutes
    if (questionTimeout) clearTimeout(questionTimeout);
    questionTimeout = setTimeout(async () => {
      if (currentQuestion && currentQuestion.question === question.question) {
        const answerDesc = getAnswerDescription(currentQuestion);
        await bot.telegram.sendMessage(GROUP_ID, `Time’s up! The correct answer was ${currentQuestion.answer}: ${answerDesc}.`, {
          message_thread_id: THREAD_ID
        });
        console.log(`Closed question: ${question.question}, Answer: ${currentQuestion.answer}`);
        currentQuestion = null; // Close question
      }
    }, 5 * 60 * 1000); // 5 minutes
  } catch (error) {
    console.error('Error posting question:', error);
  }
}

// Schedule questions for a session (6 questions in 30 minutes)
function scheduleSessionQuestions(sessionName, startHour, startMinute, day) {
  // Announcement 30 minutes before session
  let announceMinute = startMinute - 30;
  let announceHour = startHour;
  if (announceMinute < 0) {
    announceMinute += 60;
    announceHour -= 1;
    if (announceHour < 0) announceHour += 24;
  }
  const announceCron = `${announceMinute} ${announceHour} * * ${day}`;
  const sessionTime = formatTime(startHour, startMinute);
  console.log(`Scheduling announcement for ${sessionName} session: ${announceCron}`);

  // Schedule announcement
  const announceTask = cron.schedule(announceCron, () => postAnnouncement(sessionTime, sessionName), { timezone: 'UTC' });
  scheduledTasks.push(announceTask);

  // Schedule 6 questions at 5-minute intervals
  for (let i = 0; i < 6; i++) {
    const questionMinute = startMinute + i * 5;
    let questionHour = startHour + Math.floor(questionMinute / 60);
    const adjustedMinute = questionMinute % 60;
    const questionCron = `${adjustedMinute} ${questionHour} * * ${day}`;
    console.log(`Scheduling question ${i + 1} for ${sessionName} session: ${questionCron}`);
    const questionTask = cron.schedule(questionCron, () => {
      const qIndex = questionIndex + i; // Use sequential questions
      if (questions[qIndex]) {
        questions[qIndex].sessionName = sessionName; // Add sessionName for announcements
        questions[qIndex].questionNumber = i + 1; // Add questionNumber
        postQuestion(questions[qIndex]);
      } else {
        console.error(`No question available at index ${qIndex}`);
      }
      // Increment questionIndex after the last question in the session
      if (i === 5) questionIndex += 6;
    }, { timezone: 'UTC' });
    scheduledTasks.push(questionTask);
  }
}

// Schedule all sessions
async function scheduleQuestions() {
  await loadQuestions();
  console.log('Scheduling questions...');
  if (questions.length < 6) {
    console.error('Not enough questions to schedule (need at least 6)');
    return;
  }

  // Clear any existing scheduled tasks to prevent duplicates
  scheduledTasks.forEach(task => task.destroy());
  scheduledTasks = [];

  // Define session times (in UTC): Morning (10:00), Noon (14:00), Evening (19:30)
  const sessions = [
    { name: 'Morning', hour: 10, minute: 0 },
    { name: 'Noon', hour: 14, minute: 0 },
    { name: 'Evening', hour: 19, minute: 30 }
  ];

  // Schedule sessions for each weekday (Monday to Friday)
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  weekdays.forEach(day => {
    sessions.forEach(session => {
      scheduleSessionQuestions(session.name, session.hour, session.minute, day);
    });
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
  const username = ctx.from.username || ctx.from.first_name || 'A user';
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
      let reply = '';
      if (firstCorrectUser === null) {
        // First correct answer
        firstCorrectUser = userId;
        if (!scores[userId]) {
          scores[userId] = { username, points: 0 };
        }
        scores[userId].points += 1;
        await saveScores(); // Save scores to file
        reply = `Correct, ${username}! You're the first to answer correctly and earned 1 point!`;
        clearTimeout(questionTimeout); // Prevent time's up overlap
      } else {
        // Correct but not first
        reply = `Correct, ${username}, but someone else was first. Try to be quicker next time!`;
      }

      // Add post-answer announcement
      if (currentQuestion.questionNumber < 6) {
        const session = [
          { name: 'Morning', hour: 10, minute: 0 },
          { name: 'Noon', hour: 14, minute: 0 },
          { name: 'Evening', hour: 19, minute: 30 }
        ].find(s => s.name === currentQuestion.sessionName);
        const currentQuestionTime = currentQuestion.questionNumber * 5;
        const nextQuestionMinute = session.minute + currentQuestionTime + 5;
        const nextQuestionHour = session.hour + Math.floor(nextQuestionMinute / 60);
        const adjustedMinute = nextQuestionMinute % 60;
        const nextTime = formatTime(nextQuestionHour, adjustedMinute);
        reply += `\nThe next question will be posted at ${nextTime}.`;
      } else {
        const { name: nextSessionName, time: nextSessionTime, isNextDay, nextDayName } = getNextSessionDetails(currentQuestion.sessionName);
        reply += `\nThis concludes the ${currentQuestion.sessionName} session! The next session (${nextSessionName}) starts at ${nextSessionTime}${isNextDay ? ` tomorrow, ${nextDayName}` : ''}.`;
      }

      await ctx.reply(reply, { message_thread_id: THREAD_ID });
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

  const commandText = ctx.message.text.split(' ')[0].toLowerCase().replace('/', '');
  const args = ctx.message.text.split(' ').slice(1);

  try {
    if (commandText === 'start') {
      await ctx.reply('Quiz bot started! Questions will be posted in the Discussion/Q and Zone topic.', {
        message_thread_id: THREAD_ID
      });
      console.log('/start command processed successfully');
    } else if (commandText === 'help') {
      await ctx.reply(
        'Welcome to the Influenz Quiz Bot!\n' +
        '- Questions are posted in the Discussion/Q and Zone topic (6 questions every morning, noon, and evening, Monday to Friday).\n' +
        '- Reply with A, B, C, or D to answer (5-minute time limit).\n' +
        '- Only the first correct answer earns a point.\n' +
        '- Commands:\n' +
        '  /leaderboard - View top 5 scores\n' +
        '  /checkscore - Check your score\n' +
        '  /help - Show this message\n' +
        '  /testquestion [number] - Admin tests a question (optional number 1-258)',
        { message_thread_id: THREAD_ID }
      );
      console.log('/help command processed successfully');
    } else if (commandText === 'leaderboard') {
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
    } else if (commandText === 'checkscore') {
      const userId = ctx.from.id;
      const score = scores[userId]?.points || 0;
      await ctx.reply(`Your current score is ${score} points.`, {
        message_thread_id: THREAD_ID
      });
      console.log('/checkscore command processed successfully');
    } else if (commandText === 'clearleaderboard') {
      if (String(ctx.from.id) !== ADMIN_ID) {
        console.log(`Ignoring /clearleaderboard: User ID ${ctx.from.id} is not admin`);
        return;
      }
      scores = {};
      await saveScores(); // Save empty scores to file
      await ctx.reply('Leaderboard cleared!', {
        message_thread_id: THREAD_ID
      });
      console.log('/clearleaderboard command processed successfully');
    } else if (commandText === 'testquestion') {
      if (String(ctx.from.id) !== ADMIN_ID) {
        console.log(`Ignoring /testquestion: User ID ${ctx.from.id} is not admin`);
        return;
      }
      let questionToPost;
      if (args.length > 0 && !isNaN(args[0])) {
        const index = parseInt(args[0]) - 1;
        if (index >= 0 && index < questions.length) {
          questionToPost = questions[index];
        } else {
          await ctx.reply(`Invalid question index. Please use a number between 1 and ${questions.length}.`, {
            message_thread_id: THREAD_ID
          });
          return;
        }
      } else {
        questionToPost = {
          question: 'Test question? A) A B) B C) C D) D',
          answer: 'C',
          time: 'now'
        };
      }
      console.log(`Posting test question: ${questionToPost.question}`);
      await postQuestion(questionToPost);
      console.log('/testquestion command processed successfully');
    } else {
      console.log(`Unknown command: ${commandText}`);
    }
  } catch (error) {
    console.error(`Error in command ${commandText}:`, error);
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
    // Pin the message
    await bot.telegram.pinChatMessage(GROUP_ID, sentMessage.message_id, {
      disable_notification: true
    });
    console.log('Weekly leaderboard posted and pinned successfully');
    // Unpin after 24 hours
    setTimeout(() => {
      bot.telegram.unpinChatMessage(GROUP_ID, sentMessage.message_id).catch(console.error);
    }, 24 * 60 * 60 * 1000); // Unpin after 24 hours
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
  await loadScores(); // Load scores before scheduling
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
  scheduledTasks.forEach(task => task.destroy());
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, stopping bot...');
  if (isPolling) {
    await bot.stop();
    isPolling = false;
    console.log('Bot stopped');
  }
  scheduledTasks.forEach(task => task.destroy());
  process.exit(0);
});

// Express server for Render
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 10000, () => console.log(`Server running on port ${process.env.PORT || 10000}`));

startBot().catch(console.error);