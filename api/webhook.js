module.exports = async (req, res) => {
    res.status(200).send('Webhook disabled; using polling');
  };