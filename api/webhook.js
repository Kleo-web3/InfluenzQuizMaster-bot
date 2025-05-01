require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const kv = require('@vercel/kv');

const token = process.env.BOT_TOKEN;
const groupId = process.env.GROUP_ID;
const groupName = 'Influenz Education';

const bot = new TelegramBot(token, { polling: false });

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      const update = req.body;

      // Command handlers
      if (update.message && update.message.text) {
        const msg = update.message;
        const chatId = msg.chat.id.toString();
        const userId = msg.from.id;
        const username = msg.from.username || msg.from.first_name;

        if (chatId === groupId) {
          if (msg.text === '/start') {
            await bot.sendMessage(groupId, `Welcome to ${groupName}! 🎉 I’m @InfluenzQuizMaster_bot...`);
          } else if (msg.text === '/help') {
            await bot.sendMessage(groupId, "Commands:\n/start - Start the bot\n/help - Show commands\n/checkscore - Check your score");
          } else if (msg.text === '/checkscore') {
            const score = (await kv.get(`score:${userId}`)) || 0;
            await bot.sendMessage(groupId, `@${username}, you have ${score} points! Keep answering to earn more. 🏆`);
          } else if (global.currentQuestion && msg.text) {
            // Answer handling
            const answer = msg.text.toLowerCase().trim();
            if (answer === global.currentQuestion.answer.toLowerCase()) {
              const score = (await kv.get(`score:${userId}`)) || 0;
              await kv.set(`score:${userId}`, score + 1);
              await bot.sendMessage(groupId, `Nice one, @${username}! 🎉 That’s correct. You now have ${score + 1} points.`);
              global.currentQuestion = null;
            }
          }
        }
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).send('Error processing update');
    }
  } else {
    res.status(200).send('Webhook endpoint');
  }
};