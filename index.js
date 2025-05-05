const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 10000, () => console.log('Server running on port 10000'));

const bot = new TelegramBot('8198315538:AAEuudupt-LwuF48PQvZ4Nmx9n9fFMVWpLA', { polling: true });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Welcome to the Influenz Education Quiz! 🚀 Type /help for rules.');
  console.log('Sent /start response');
});

bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Answer quiz questions with buttons. Each correct answer = 1 point. Type /score to check your points. Have fun!');
});

bot.onText(/\/score/, (msg) => {
  try {
    const responses = fs.readFileSync('responses.json', 'utf-8')
      .split('\n')
      .filter(line => line)
      .map(JSON.parse);
    const userResponses = responses.filter(r => r.userId == msg.from.id);
    const points = userResponses.filter(r => r.isCorrect).length;
    bot.sendMessage(msg.chat.id, `Yo, you got ${points} points!`);
  } catch (e) {
    bot.sendMessage(msg.chat.id, 'No scores yet! Answer some questions first.');
  }
});

bot.on('callback_query', (query) => {
  const [questionId, answer] = query.data.split(':');
  const questions = JSON.parse(fs.readFileSync('questions.json', 'utf-8'));
  const question = questions.find(q => q.id == questionId);
  if (!question) {
    bot.answerCallbackQuery(query.id, { text: 'Question not found!' });
    return;
  }
  const isCorrect = answer === question.correct;
  const response = {
    userId: query.from.id,
    username: query.from.username || query.from.first_name,
    questionId,
    answer,
    isCorrect,
    timestamp: new Date().toISOString()
  };
  fs.appendFileSync('responses.json', JSON.stringify(response) + '\n');
  bot.answerCallbackQuery(query.id, { text: isCorrect ? 'Correct! 🎉' : 'Wrong! Try again next time.' });
});

cron.schedule('* * * * *', () => {
  console.log(`Question cron triggered at ${new Date().toISOString()}`);
  const questions = JSON.parse(fs.readFileSync('questions.json', 'utf-8'));
  const now = new Date();
  questions.forEach(q => {
    const schedule = new Date(q.schedule);
    if (
      now.getFullYear() === schedule.getFullYear() &&
      now.getMonth() === schedule.getMonth() &&
      now.getDate() === schedule.getDate() &&
      now.getHours() === schedule.getHours() &&
      now.getMinutes() === schedule.getMinutes() &&
      !q.sent
    ) {
      console.log(`Posting question ${q.id}`);
      bot.sendMessage('1002288817447', `${q.text}\n${q.options.join('\n')}`, {
        reply_markup: {
          inline_keyboard: q.options.map((opt, i) => [{
            text: opt,
            callback_data: `${q.id}:${String.fromCharCode(65 + i)}`
          }])
        }
      });
      q.sent = true;
      fs.writeFileSync('questions.json', JSON.stringify(questions, null, 2));
    }
  });
}, { timezone: 'Africa/Lagos' });

// Announcement for main quiz
cron.schedule('0 18 6 5 *', () => {
  bot.sendMessage('1002288817447', 'Yo, the Influenz Education Quiz kicks off at 6:30 PM WAT tomorrow! Answer questions, rack up points, and show off your skills. Type /start to join, /help for rules. Let’s go! 🚀');
}, { timezone: 'Africa/Lagos' });

console.log('Bot started with polling');