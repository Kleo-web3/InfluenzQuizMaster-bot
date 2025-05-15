// @ts-nocheck
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

// Message queue to throttle sending
const messageQueue = [];
let isSendingMessage = false;

async function sendMessageWithQueue(chatId, text, options) {
  return new Promise((resolve, reject) => {
    messageQueue.push({ chatId, text, options, resolve, reject });
    processMessageQueue();
  });
}

async function processMessageQueue() {
  if (isSendingMessage || messageQueue.length === 0) return;
  isSendingMessage = true;

  const { chatId, text, options, resolve, reject } = messageQueue.shift();
  try {
    const sentMessage = await bot.telegram.sendMessage(chatId, text, options);
    await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay to avoid rate limits
    resolve(sentMessage);
  } catch (error) {
    reject(error);
  } finally {
    isSendingMessage = false;
    processMessageQueue();
  }
}

let scores = {};
let questions = [];
let currentQuestion = null;
let firstAttempts = new Map();
let firstCorrectUser = null;
let isPolling = false;
let questionTimeout = null;
let scheduledTasks = [];
let questionIndex = 0;

// Track active leaderboard messages for auto-deletion
const activeLeaderboardMessages = new Set();

async function saveQuestions() {
  try {
    const fs = require('fs').promises;
    await fs.writeFile(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
    console.log('Questions saved successfully');
  } catch (error) {
    console.error('Error saving questions:', error);
    throw error;
  }
}

async function loadQuestions() {
  try {
    const fs = require('fs').promises;
    console.log('Checking if questions.json exists...');
    const exists = await fs.access(QUESTIONS_FILE).then(() => true).catch(() => false);
    if (!exists) {
      console.error('questions.json does not exist');
      questions = [];
      return;
    }

    console.log('Reading questions.json...');
    const data = await fs.readFile(QUESTIONS_FILE, 'utf8');
    if (!data.trim()) {
      console.error('questions.json is empty');
      questions = [];
      return;
    }

    console.log('Parsing questions.json...');
    let loadedQuestions = JSON.parse(data);
    console.log(`Loaded ${loadedQuestions.length} questions from questions.json`);

    // Check if questions are in the old format (question string with embedded options)
    const isOldFormat = loadedQuestions.length > 0 && typeof loadedQuestions[0].question === 'string' && loadedQuestions[0].question.includes(' A) ');

    if (isOldFormat) {
      console.log('Detected old question format, restructuring and randomizing answers...');
      loadedQuestions = loadedQuestions.map(q => {
        const questionText = q.question.split(' A)')[0];
        const optionsText = q.question.split(' A) ')[1];
        const optionA = optionsText.split(' B) ')[0];
        const optionB = optionsText.split(' B) ')[1].split(' C) ')[0];
        const optionC = optionsText.split(' C) ')[1].split(' D) ')[0];
        const optionD = optionsText.split(' D) ')[1];

        const optionsArray = [
          { label: 'A', text: optionA },
          { label: 'B', text: optionB },
          { label: 'C', text: optionC },
          { label: 'D', text: optionD }
        ];

        const correctOption = optionsArray.find(opt => opt.label === q.answer);
        if (!correctOption) {
          console.error(`Invalid answer for question: ${questionText}`);
          return null;
        }

        // Shuffle options
        const shuffledOptions = shuffleArray([...optionsArray]);
        const newCorrectOption = shuffledOptions.find(opt => opt.text === correctOption.text);
        if (!newCorrectOption) {
          console.error(`Failed to find new correct option for question: ${questionText}`);
          return null;
        }
        const newAnswer = newCorrectOption.label;

        return {
          question: questionText,
          options: {
            A: shuffledOptions[0].text,
            B: shuffledOptions[1].text,
            C: shuffledOptions[2].text,
            D: shuffledOptions[3].text
          },
          answer: newAnswer
        };
      }).filter(q => q !== null);
    } else {
      console.log('Questions already in new format, randomizing answers...');
      loadedQuestions = loadedQuestions.map(q => {
        if (!q.options || !q.answer) {
          console.error(`Invalid question format: ${JSON.stringify(q)}`);
          return null;
        }

        const optionsArray = [
          { label: 'A', text: q.options.A },
          { label: 'B', text: q.options.B },
          { label: 'C', text: q.options.C },
          { label: 'D', text: q.options.D }
        ];

        const correctOption = optionsArray.find(opt => opt.label === q.answer);
        if (!correctOption) {
          console.error(`Invalid answer for question: ${q.question}`);
          return null;
        }

        // Shuffle options
        const shuffledOptions = shuffleArray([...optionsArray]);
        const newCorrectOption = shuffledOptions.find(opt => opt.text === correctOption.text);
        if (!newCorrectOption) {
          console.error(`Failed to find new correct option for question: ${q.question}`);
          return null;
        }
        const newAnswer = newCorrectOption.label;

        return {
          question: q.question,
          options: {
            A: shuffledOptions[0].text,
            B: shuffledOptions[1].text,
            C: shuffledOptions[2].text,
            D: shuffledOptions[3].text
          },
          answer: newAnswer
        };
      }).filter(q => q !== null);
    }

    console.log(`Processed ${loadedQuestions.length} questions after randomization`);

    // Save the restructured/randomized questions
    questions = loadedQuestions;
    console.log('Saving randomized questions...');
    await saveQuestions();

    // Log the distribution of answers
    const answerDistribution = { A: 0, B: 0, C: 0, D: 0 };
    questions.forEach(q => {
      answerDistribution[q.answer]++;
    });
    console.log('Answer distribution after randomization:', answerDistribution);

    if (Object.values(answerDistribution).every(count => count === 0)) {
      console.error('No valid answers found after randomization. Check questions.json format.');
    }

    questions = shuffleQuestions(questions);
    console.log(`Loaded and shuffled ${questions.length} questions`);
    if (questions.length < 258) {
      console.warn(`Warning: Only ${questions.length} questions loaded. Expected 258 for 43 sessions.`);
    }
  } catch (error) {
    console.error('Error loading questions:', error);
    questions = [];
    throw error; // Rethrow to fail startup and alert us to the issue
  }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function shuffleQuestions(array) {
  return shuffleArray(array);
}

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
    if (!data.trim()) {
      console.log('scores.json is empty, initializing empty scores');
      scores = {};
      await saveScores();
      return;
    }
    const parsedScores = JSON.parse(data);
    if (typeof parsedScores !== 'object' || parsedScores === null || Array.isArray(parsedScores)) {
      console.error('scores.json contains invalid data, initializing empty scores');
      scores = {};
      await saveScores();
      return;
    }
    scores = parsedScores;
    console.log(`Loaded scores:`, JSON.stringify(scores, null, 2));
  } catch (error) {
    console.error('Error loading scores, keeping existing scores:', error);
    if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
      scores = {};
      await saveScores();
    }
  }
}

async function saveScores() {
  try {
    const fs = require('fs').promises;
    await fs.writeFile(SCORES_FILE, JSON.stringify(scores, null, 2));
    console.log('Scores saved successfully');
  } catch (error) {
    console.error('Error saving scores:', error);
  }
}

function formatTime(hour, minute) {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} UTC`;
}

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

function formatQuestion(q) {
  let message = `Here’s the question: *${q.question}*\n`;
  message += `A) ${q.options.A}\n`;
  message += `B) ${q.options.B}\n`;
  message += `C) ${q.options.C}\n`;
  message += `D) ${q.options.D}\n`;
  message += `Reply with the letter (A, B, C, or D)!`;
  return message;
}

function getAnswerDescription(q) {
  return q.options[q.answer];
}

async function postAnnouncement(sessionTime, sessionName) {
  console.log(`Posting announcement for ${sessionName} session at ${sessionTime} UTC`);
  try {
    await sendMessageWithQueue(GROUP_ID, `Quiz session (${sessionName}) with 6 questions starts in 30 minutes at ${sessionTime} UTC! Get ready!`, {
      message_thread_id: THREAD_ID
    });
    console.log(`Announcement for ${sessionName} session posted successfully`);
  } catch (error) {
    console.error(`Error posting announcement for ${sessionName} session:`, error);
  }
}

async function postQuestion(question) {
  console.log(`Posting question: ${question.question}`);
  try {
    await sendMessageWithQueue(GROUP_ID, formatQuestion(question), {
      message_thread_id: THREAD_ID
    });
    currentQuestion = question;
    firstAttempts.clear();
    firstCorrectUser = null;
    console.log('Question posted successfully');

    if (questionTimeout) clearTimeout(questionTimeout);
    questionTimeout = setTimeout(async () => {
      if (currentQuestion && currentQuestion.question === question.question) {
        const answerDesc = getAnswerDescription(currentQuestion);
        await sendMessageWithQueue(GROUP_ID, `Time’s up! The correct answer was ${currentQuestion.answer}: ${answerDesc}.`, {
          message_thread_id: THREAD_ID
        });
        console.log(`Closed question: ${question.question}, Answer: ${currentQuestion.answer}`);
        currentQuestion = null;
      }
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error('Error posting question:', error);
  }
}

function scheduleSessionQuestions(sessionName, startHour, startMinute, day) {
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

  const announceTask = cron.schedule(announceCron, () => postAnnouncement(sessionTime, sessionName), { timezone: 'UTC' });
  scheduledTasks.push(announceTask);

  for (let i = 0; i < 6; i++) {
    const questionMinute = startMinute + i * 5;
    let questionHour = startHour + Math.floor(questionMinute / 60);
    const adjustedMinute = questionMinute % 60;
    const questionCron = `${adjustedMinute} ${questionHour} * * ${day}`;
    console.log(`Scheduling question ${i + 1} for ${sessionName} session: ${questionCron}`);
    const questionTask = cron.schedule(questionCron, () => {
      const qIndex = questionIndex + i;
      if (questions[qIndex]) {
        questions[qIndex].sessionName = sessionName;
        questions[qIndex].questionNumber = i + 1;
        postQuestion(questions[qIndex]);
      } else {
        console.error(`No question available at index ${qIndex}`);
        sendMessageWithQueue(GROUP_ID, 'Error: No more questions available. Please contact the admin.', {
          message_thread_id: THREAD_ID
        });
      }
      if (i === 5) questionIndex += 6;
    }, { timezone: 'UTC' });
    scheduledTasks.push(questionTask);
  }
}

async function scheduleQuestions() {
  await loadQuestions();
  console.log('Scheduling questions...');
  if (questions.length < 6) {
    console.error('Not enough questions to schedule (need at least 6)');
    return;
  }

  scheduledTasks.forEach(task => task.stop());
  scheduledTasks = [];

  const sessions = [
    { name: 'Morning', hour: 10, minute: 0 },
    { name: 'Noon', hour: 14, minute: 0 },
    { name: 'Evening', hour: 19, minute: 30 }
  ];

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  weekdays.forEach(day => {
    sessions.forEach(session => {
      scheduleSessionQuestions(session.name, session.hour, session.minute, day);
    });
  });
}

bot.hears(['A', 'B', 'C', 'D'], async (ctx) => {
  console.log(`Received answer: ${ctx.message.text}, Chat ID: ${ctx.chat.id}, Thread ID: ${ctx.message.message_thread_id}, User ID: ${ctx.from.id}`);
  if (String(ctx.chat.id) !== GROUP_ID || String(ctx.message.message_thread_id) !== THREAD_ID) {
    console.log(`Ignoring answer: Chat ID match: ${String(ctx.chat.id) === GROUP_ID}, Thread ID match: ${String(ctx.message.message_thread_id) === THREAD_ID}`);
    return;
  }

  if (!currentQuestion) {
    console.log('Ignoring answer: No current question active');
    await sendMessageWithQueue(GROUP_ID, 'No active question right now. Wait for the next quiz!', {
      message_thread_id: THREAD_ID
    });
    return;
  }

  const userId = ctx.from.id;
  const username = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || 'A user';
  const answer = ctx.message.text.trim().toUpperCase();

  const attemptKey = `${userId}:${currentQuestion.question}`;
  if (firstAttempts.has(attemptKey)) {
    console.log(`User ${username} (ID: ${userId}) already attempted: ${attemptKey}`);
    return;
  }

  firstAttempts.set(attemptKey, answer);
  console.log(`Recorded first attempt: ${username} (ID: ${userId}) -> ${answer}`);

  try {
    if (answer === currentQuestion.answer) {
      let reply = '';
      if (firstCorrectUser === null) {
        firstCorrectUser = userId;
        if (!scores[userId]) {
          scores[userId] = { username, points: 0 };
        }
        scores[userId].points += 1;
        await saveScores();
        console.log(`Score updated for ${username} (ID: ${userId}): ${scores[userId].points} points`);
        reply = `Correct, ${username}! You're the first to answer correctly and earned 1 point!`;
        clearTimeout(questionTimeout);
      } else {
        reply = `Correct, ${username}, but someone else was first. Try to be quicker next time!`;
      }

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
        reply = `${reply}\nThe next question will be posted at ${nextTime}.`;
      } else {
        const { name: nextSessionName, time: nextSessionTime, isNextDay, nextDayName } = getNextSessionDetails(currentQuestion.sessionName);
        reply = `${reply}\nThis concludes the ${currentQuestion.sessionName} session! The next session (${nextSessionName}) starts at ${nextSessionTime}${isNextDay ? ` tomorrow, ${nextDayName}` : ''}.`;
      }

      await sendMessageWithQueue(GROUP_ID, reply, { message_thread_id: THREAD_ID });
    } else {
      await sendMessageWithQueue(GROUP_ID, `Sorry, ${username}, that's incorrect. Try the next one!`, {
        message_thread_id: THREAD_ID
      });
      console.log(`Incorrect answer by ${username} (ID: ${userId})`);
    }
  } catch (error) {
    console.error(`Error handling answer for ${username} (ID: ${userId}):`, error);
    await sendMessageWithQueue(GROUP_ID, 'Error processing answer. Please try again.', {
      message_thread_id: THREAD_ID
    });
  }
});

bot.on('message', async (ctx) => {
  if (!ctx.message.text || !ctx.message.text.startsWith('/')) {
    console.log(`Ignoring non-command message: ${ctx.message.text || 'no text'}`);
    return;
  }

  console.log(`Received command: ${ctx.message.text}, Chat ID: ${ctx.chat.id}, Thread ID: ${ctx.message.message_thread_id}, User ID: ${ctx.from.id}, Username: ${ctx.from.username || ctx.from.first_name}`);
  if (String(ctx.chat.id) !== GROUP_ID || String(ctx.message.message_thread_id) !== THREAD_ID) {
    console.log(`Ignoring command: Chat ID match: ${String(ctx.chat.id) === GROUP_ID}, Thread ID match: ${String(ctx.message.message_thread_id) === THREAD_ID}`);
    return;
  }

  const commandText = ctx.message.text.split(' ')[0].toLowerCase().replace('/', '');
  const args = ctx.message.text.split(' ').slice(1);

  try {
    if (commandText === 'start') {
      await sendMessageWithQueue(GROUP_ID, 'Quiz bot started! Questions will be posted in the Discussion/Q and Zone topic.', {
        message_thread_id: THREAD_ID
      });
      console.log('/start command processed successfully');
    } else if (commandText === 'help') {
      await sendMessageWithQueue(GROUP_ID,
        'Welcome to the Influenz Quiz Bot!\n' +
        '- Questions are posted in the Discussion/Q and Zone topic (6 questions every morning, noon, and evening, Monday to Friday).\n' +
        '- Reply with A, B, C, or D to answer (5-minute time limit).\n' +
        '- Only the first correct answer earns a point.\n' +
        '- Commands:\n' +
        '  /leaderboard - View top 5 scores\n' +
        '  /checkscore - Check your score\n' +
        '  /sessions - List session times\n' +
        '  /help - Show this message\n' +
        '  /testquestion [number] - Admin tests a question (optional number 1-258)',
        { message_thread_id: THREAD_ID }
      );
      console.log('/help command processed successfully');
    } else if (commandText === 'sessions') {
      await sendMessageWithQueue(GROUP_ID,
        'Quiz Session Times (UTC, Monday–Friday):\n' +
        'Morning Session: 10:00 UTC\n' +
        'Noon Session: 14:00 UTC\n' +
        'Evening Session: 19:30 UTC\n' +
        'Announcements are posted 30 minutes before each session.',
        { message_thread_id: THREAD_ID }
      );
      console.log('/sessions command processed successfully');
    } else if (commandText === 'leaderboard') {
      try {
        const sortedScores = Object.values(scores)
          .sort((a, b) => b.points - a.points)
          .slice(0, 5);
        let message = '*Leaderboard \\(Top 5\\)*\n\n';
        message += '```\n';
        message += 'Username        Points\n';
        if (sortedScores.length === 0) {
          message += 'No scores yet.\n';
        } else {
          sortedScores.forEach((s) => {
            let displayName = s.username;
            if (!displayName || !displayName.startsWith('@')) {
              displayName = `User_${Object.keys(scores).find(key => scores[key] === s)}`;
            }
            displayName = displayName.replace(/[_\*\[\]\(\)~`>#\+\-\|={\}\.\!]/g, '\\$&');
            message += `${displayName.padEnd(15)} ${s.points}\n`;
          });
        }
        message += '```';
        console.log(`Attempting to send leaderboard message: ${message}`);
        const sentMessage = await sendMessageWithQueue(GROUP_ID, message, {
          parse_mode: 'MarkdownV2',
          message_thread_id: THREAD_ID
        });
        activeLeaderboardMessages.add(sentMessage.message_id);
        setTimeout(() => {
          if (activeLeaderboardMessages.has(sentMessage.message_id)) {
            bot.telegram.deleteMessage(GROUP_ID, sentMessage.message_id).catch((error) => {
              if (error.response?.error_code === 400) {
                console.log('Leaderboard message already deleted, ignoring error');
              } else if (error.response?.error_code === 429) {
                console.log('Rate limit hit while deleting leaderboard message, retrying in 5 seconds');
                setTimeout(() => {
                  bot.telegram.deleteMessage(GROUP_ID, sentMessage.message_id).catch(console.error);
                }, 5000);
              } else {
                console.error('Error deleting leaderboard message:', error);
              }
            });
            activeLeaderboardMessages.delete(sentMessage.message_id);
          }
        }, 5 * 60 * 1000); // Delete after 5 minutes
        console.log('/leaderboard command processed successfully');
      } catch (error) {
        console.error('Error in leaderboard command:', error);
        if (error.response?.error_code === 429) {
          console.log('Rate limit hit for leaderboard, retrying in 5 seconds');
          setTimeout(async () => {
            try {
              const retryMessage = await sendMessageWithQueue(GROUP_ID, message, {
                parse_mode: 'MarkdownV2',
                message_thread_id: THREAD_ID
              });
              console.log('/leaderboard command retried successfully');
              activeLeaderboardMessages.add(retryMessage.message_id);
            } catch (retryError) {
              console.error('Error retrying leaderboard command:', retryError);
              await sendMessageWithQueue(GROUP_ID, 'Error posting leaderboard due to rate limits. Please try again later.', {
                message_thread_id: THREAD_ID
              });
            }
          }, 5000);
        } else {
          console.error('Error in leaderboard command:', error);
          await sendMessageWithQueue(GROUP_ID, 'Error posting leaderboard. Please try again.', {
            message_thread_id: THREAD_ID
          });
        }
      }
    } else if (commandText === 'checkscore') {
      const userId = ctx.from.id;
      const score = scores[userId]?.points || 0;
      await sendMessageWithQueue(GROUP_ID, `Your current score is ${score} points.`, {
        message_thread_id: THREAD_ID
      });
      console.log('/checkscore command processed successfully');
    } else if (commandText === 'clearleaderboard') {
      if (String(ctx.from.id) !== ADMIN_ID) {
        console.log(`Ignoring /clearleaderboard: User ID ${ctx.from.id} is not admin`);
        return;
      }
      scores = {};
      await saveScores();
      await sendMessageWithQueue(GROUP_ID, 'Leaderboard cleared!', {
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
          await sendMessageWithQueue(GROUP_ID, `Invalid question index. Please use a number between 1 and ${questions.length}.`, {
            message_thread_id: THREAD_ID
          });
          return;
        }
      } else {
        questionToPost = {
          question: 'Test question?',
          options: {
            A: 'A',
            B: 'B',
            C: 'C',
            D: 'D'
          },
          answer: 'C',
          time: 'now'
        };
      }
      console.log(`Posting test question: ${questionToPost.question}`);
      console.log(`Correct answer: ${questionToPost.answer}`);
      await postQuestion(questionToPost);
      console.log('/testquestion command processed successfully');
    } else {
      console.log(`Unknown command: ${commandText}`);
    }
  } catch (error) {
    console.error(`Error in command ${commandText} for User ID ${ctx.from.id}:`, error);
    await sendMessageWithQueue(GROUP_ID, 'Error processing command. Please try again.', {
      message_thread_id: THREAD_ID
    });
  }
});

// Weekly leaderboard on Saturday
cron.schedule('0 7,19 * * 6', async () => {
  console.log('Posting weekly leaderboard');
  try {
    const sortedScores = Object.values(scores)
      .sort((a, b) => b.points - a.points)
      .slice(0, 5);

    let message = '*Weekly Leaderboard \\(Top 5\\)*\n\n';
    message += '```\n';
    message += 'Username        Points\n';
    if (sortedScores.length === 0) {
      message += 'No scores yet.\n';
    } else {
      sortedScores.forEach((s) => {
        let displayName = s.username;
        if (!displayName || !displayName.startsWith('@')) {
          displayName = `User_${Object.keys(scores).find(key => scores[key] === s)}`;
        }
        displayName = displayName.replace(/[_\*\[\]\(\)~`>#\+\-\|={\}\.\!]/g, '\\$&');
        message += `${displayName.padEnd(15)} ${s.points}\n`;
      });
    }
    message += '```';

    const sentMessage = await sendMessageWithQueue(GROUP_ID, message, {
      parse_mode: 'MarkdownV2',
      message_thread_id: THREAD_ID
    });
    await bot.telegram.pinChatMessage(GROUP_ID, sentMessage.message_id, {
      disable_notification: true
    });
    console.log('Weekly leaderboard posted and pinned successfully');
    setTimeout(() => {
      bot.telegram.unpinChatMessage(GROUP_ID, sentMessage.message_id).catch(console.error);
    }, 24 * 60 * 60 * 1000); // Unpin after 24 hours
  } catch (error) {
    console.error('Error posting weekly leaderboard:', error);
  }
}, { timezone: 'UTC' });

async function startBot() {
  if (isPolling) {
    console.log('Polling already active, skipping start');
    return;
  }
  isPolling = true;
  console.log('Starting bot...');
  await loadScores();
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

process.on('SIGINT', async () => {
  console.log('Received SIGINT, stopping bot...');
  if (isPolling) {
    await bot.stop();
    isPolling = false;
    console.log('Bot stopped');
  }
  scheduledTasks.forEach(task => task.stop());
  scheduledTasks = [];
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, stopping bot...');
  if (isPolling) {
    await bot.stop();
    isPolling = false;
    console.log('Bot stopped');
  }
  scheduledTasks.forEach(task => task.stop());
  scheduledTasks = [];
  process.exit(0);
});

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 10000, () => console.log(`Server running on port ${process.env.PORT || 10000}`));

startBot().catch(console.error);