const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
require('dotenv').config();

const token = process.env.BOT_TOKEN;
const groupId = process.env.GROUP_ID;
const bot = new TelegramBot(token, { polling: true });

let questions = [];
let currentQuestion = null;
let scheduledTasks = [];
let questionIndex = 0; // Tracks current question for sequential selection

console.log('Starting bot...');

function shuffleQuestions(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function loadQuestions() {
  try {
    const data = fs.readFileSync('questions.json');
    questions = JSON.parse(data);
    questions = shuffleQuestions(questions); // Shuffle once at startup
    console.log(`Loaded and shuffled ${questions.length} questions`);
  } catch (error) {
    console.error('Error loading questions:', error);
  }
}

loadQuestions();

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

function postQuestion(chatId, questionIndex, sessionName, questionNumber) {
  if (currentQuestion) {
    console.log(`Question already active, skipping question ${questionIndex}`);
    return;
  }

  const question = questions[questionIndex];
  if (!question) {
    console.log(`No question available at index ${questionIndex}`);
    return;
  }

  const message = `${question.question}\n\nReply with A, B, C, or D to answer! (Session: ${sessionName}, Question ${questionNumber}/6)`;
  bot.sendMessage(chatId, message).then((sentMessage) => {
    console.log(`Question posted: ${question.question}`);
    currentQuestion = {
      index: questionIndex,
      correctAnswer: question.answer,
      messageId: sentMessage.message_id,
      chatId: chatId,
      sessionName: sessionName,
      questionNumber: questionNumber,
      answered: false
    };

    setTimeout(() => {
      if (!currentQuestion.answered) {
        bot.sendMessage(chatId, `Time's up! The correct answer was ${question.answer}.`);
        currentQuestion = null;
      }
    }, 5 * 60 * 1000);
  }).catch((error) => {
    console.error('Error posting question:', error);
  });
}

function postAnnouncement(chatId, sessionName, sessionTime) {
  const message = `Quiz session (${sessionName}) with 6 questions starts in 30 minutes at ${sessionTime}!`;
  bot.sendMessage(chatId, message).then(() => {
    console.log(`Announcement for ${sessionName} session posted successfully`);
  }).catch((error) => {
    console.error('Error posting announcement:', error);
  });
}

function scheduleSessionQuestions() {
  console.log('Scheduling questions...');
  scheduledTasks.forEach(task => task.destroy());
  scheduledTasks = [];

  const sessions = [
    { name: 'Morning', hour: 10, minute: 0 },
    { name: 'Noon', hour: 14, minute: 0 },
    { name: 'Evening', hour: 19, minute: 30 }
  ];

  sessions.forEach(session => {
    const { name, hour, minute } = session;
    const sessionTime = formatTime(hour, minute);

    // Schedule 30-minute announcement
    const announceMinute = (minute - 30 + 60) % 60;
    const announceHour = minute >= 30 ? hour : hour - 1;
    const cronTimeAnnounce = `${announceMinute} ${announceHour} * * Monday-Friday`;
    scheduledTasks.push(cron.schedule(cronTimeAnnounce, () => {
      postAnnouncement(groupId, name, sessionTime);
    }, { timezone: 'UTC' }));
    console.log(`Scheduling announcement for ${name} session: ${cronTimeAnnounce}`);

    // Schedule 6 questions
    for (let i = 0; i < 6; i++) {
      const questionMinute = minute + i * 5;
      const questionHour = hour + Math.floor(questionMinute / 60);
      const adjustedMinute = questionMinute % 60;
      const cronTime = `${adjustedMinute} ${questionHour} * * Monday-Friday`;

      scheduledTasks.push(cron.schedule(cronTime, () => {
        const qIndex = questionIndex + i; // Use sequential questions
        if (qIndex < questions.length) {
          postQuestion(groupId, qIndex, name, i + 1);
        } else {
          console.log('No more questions available');
        }
        // Increment questionIndex after the last question in the session
        if (i === 5) {
          questionIndex += 6;
        }
      }, { timezone: 'UTC' }));
      console.log(`Scheduling question ${i + 1} for ${name} session: ${cronTime}`);
    }
  });
}

scheduleSessionQuestions();

bot.on('message', (msg) => {
  if (msg.chat.id.toString() === groupId && currentQuestion && !msg.from.is_bot) {
    const userAnswer = msg.text.trim().toUpperCase();
    if (['A', 'B', 'C', 'D'].includes(userAnswer) && !currentQuestion.answered) {
      if (userAnswer === currentQuestion.correctAnswer) {
        currentQuestion.answered = true;
        const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || 'A user';
        let announcement = `Correct! ${username} gets a point!`;

        if (currentQuestion.questionNumber < 6) {
          // Next question time (5 minutes later)
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
          announcement += `\nThe next question will be posted at ${nextTime}.`;
        } else {
          // End of session, next session time
          const { name: nextSessionName, time: nextSessionTime, isNextDay, nextDayName } = getNextSessionDetails(currentQuestion.sessionName);
          announcement += `\nThis concludes the ${currentQuestion.sessionName} session! The next session (${nextSessionName}) starts at ${nextSessionTime}${isNextDay ? ` tomorrow, ${nextDayName}` : ''}.`;
        }

        bot.sendMessage(groupId, announcement);
        currentQuestion = null;
      } else {
        bot.sendMessage(groupId, `Sorry, ${msg.from.first_name || 'user'}, that's incorrect. Try again!`);
      }
    }
  }
});

bot.onText(/\/testquestion (\d+)/, (msg, match) => {
  if (msg.chat.id.toString() === groupId) {
    const questionIndex = parseInt(match[1]) - 1;
    if (questionIndex >= 0 && questionIndex < questions.length) {
      postQuestion(groupId, questionIndex, 'Test', 1);
    } else {
      bot.sendMessage(groupId, 'Invalid question index.');
    }
  }
});

console.log('Bot started with polling');