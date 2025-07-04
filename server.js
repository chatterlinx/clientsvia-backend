const app = require('./app');
const https = require('https');
const fs = require('fs');

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV === 'production') {
  const options = {
    key: fs.readFileSync(process.env.TLS_KEY_PATH),
    cert: fs.readFileSync(process.env.TLS_CERT_PATH)
  };
  https.createServer(options, app).listen(PORT, () => {
    console.log(`Secure server running on port ${PORT}`);
  });
} else {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
