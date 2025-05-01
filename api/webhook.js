const TelegramBot = require('node-telegram-bot-api');

const token = '8198315538:AAEuudupt-LwuF48PQvZ4Nmx9n9fFMVWpLA';
const bot = new TelegramBot(token, { polling: false });

module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      const update = req.body;
      await bot.processUpdate(update);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).send('Error processing update');
    }
  } else {
    res.status(200).send('Webhook endpoint');
  }
};