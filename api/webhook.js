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
      console.log('Received Telegram update:', JSON.stringify(update, null, 2));

      // Command and message handlers
      if (update.message && update.message.text) {
        const msg = update.message;
        const chatId = msg.chat.id.toString();
        const userId = msg.from.id;
        const username = msg.from.username || msg.from.first_name;
        const text = msg.text;

        console.log(`Message from ${username} in chat ${chatId}: ${text}`);

        if (chatId === groupId) {
          if (text === '/start') {
            await bot.sendMessage(groupId, `Welcome to ${groupName}! 🎉 I’m @InfluenzQuizMaster_bot...`);
            console.log('Sent /start response');
          } else if (text === '/help') {
            await bot.sendMessage(groupId, "Commands:\n/start - Start the bot\n/help - Show commands\n/checkscore - Check your score");
            console.log('Sent /help response');
          } else if (text === '/checkscore') {
            const score = (await kv.get(`score:${userId}`)) || 0;
            await bot.sendMessage(groupId, `@${username}, you have ${score} points! Keep answering to earn more. 🏆`);
            console.log(`Sent /checkscore response for ${username}: ${score} points`);
          } else if (global.currentQuestion && text) {
            const answer = text.toLowerCase().trim();
            if (answer === global.currentQuestion.answer.toLowerCase()) {
              const score = (await kv.get(`score:${userId}`)) || 0;
              await kv.set(`score:${userId}`, score + 1);
              await bot.sendMessage(groupId, `Nice one, @${username}! 🎉 That’s correct. You now have ${score + 1} points.`);
              global.currentQuestion = null;
              console.log(`Correct answer from ${username}, new score: ${score + 1}`);
            } else {
              console.log(`Incorrect answer from ${username}: ${answer}`);
            }
          }
        } else {
          console.log(`Message ignored: Chat ID ${chatId} does not match group ID ${groupId}`);
        }
      } else {
        console.log('No message text in update');
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